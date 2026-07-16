// Golden-path test: drives the REAL server actions over HTTP (the same wire
// protocol the browser uses) against a running `next start` + real Neon.
// Covers: create event -> login -> save profile -> seeded requests ->
// send meet (test auto-accept) -> accept request -> chat -> mutual "we met".
// Usage: npm run build && npx next start -p 3999 &
//        node --env-file=.env.local scripts/golden-path.mjs
import postgres from "postgres";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3999";
const sql = postgres(process.env.DATABASE_URL, { ssl: "require" });

let ok = true;
const check = (label, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) ok = false;
};

// Server-action ids from the build manifest.
const manifest = JSON.parse(
  readFileSync(".next/server/server-reference-manifest.json", "utf8"),
);
const actionId = (name) => {
  const hit = Object.entries(manifest.node).find(
    ([, v]) => v.exportedName === name && v.filename === "src/lib/actions.ts",
  );
  if (!hit) throw new Error(`no action id for ${name}`);
  return hit[0];
};

let cookie = "";
function grabCookie(res) {
  const set = res.headers.getSetCookie?.() ?? [];
  for (const c of set) {
    if (c.startsWith("lm_session=")) cookie = c.split(";")[0];
  }
}

async function callAction(path, name, args) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Next-Action": actionId(name),
      "Content-Type": "text/plain;charset=UTF-8",
      Accept: "text/x-component",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(args),
  });
  grabCookie(res);
  return res;
}

// Form actions go through the progressive-enhancement path: a plain
// multipart POST with an $ACTION_ID field (stable, unlike the JS flight
// encoding).
async function callFormAction(path, name, fields) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append(`$ACTION_ID_${actionId(name)}`, "");
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: cookie ? { cookie } : {},
    body: fd,
  });
  grabCookie(res);
  return res;
}

const EMAIL = "golden@e2e.test";
let eventId = null;

try {
  // ---- 1. create event (with seeded test attendees) --------------------------
  const create = await callAction("/new", "createEvent", [
    "Golden Path Con",
    new Date().toISOString(), // starts now -> Connect is live
    EMAIL,
    6,
  ]);
  check("createEvent action responds", create.status === 200);

  const evt = await sql`
    select id from events where name = 'Golden Path Con'
    order by created_at desc limit 1`;
  eventId = evt[0]?.id;
  check("event row created", !!eventId);

  const codeRow = await sql`
    select code from access_codes where event_id = ${eventId} and email = ${EMAIL}`;
  check("pre-bound access code generated", codeRow.length === 1);
  const testers = await sql`
    select id from profiles where event_id = ${eventId} and is_test = true`;
  check("6 test attendees seeded", testers.length === 6);

  // ---- 2. login with the (event, email, code) triple --------------------------
  await callAction(`/${eventId}`, "login", [eventId, EMAIL, codeRow[0].code]);
  check("login sets a session cookie", cookie.startsWith("lm_session="));
  const claimed = await sql`
    select claimed_at from access_codes where event_id = ${eventId} and email = ${EMAIL}`;
  check("code marked claimed", !!claimed[0].claimed_at);

  // ---- 3. save profile (form action) ------------------------------------------
  const save = await callFormAction(`/${eventId}/profile`, "saveProfile", {
    name: "Golden Tester",
    headline: "Here to verify everything",
    tags: "AI, coffee",
    photo_url: "",
    solo: "on",
  });
  check("saveProfile redirects to explore", save.status === 303);
  const meRow = await sql`
    select id, solo from profiles where event_id = ${eventId} and email = ${EMAIL}`;
  const me = meRow[0]?.id;
  check("profile row created with solo flag", !!me && meRow[0].solo === true);

  const seededReqs = await sql`
    select from_id from intents where event_id = ${eventId} and to_id = ${me}
    and status = 'pending' and kind in ('meet','link')`;
  check("~half the test users sent me pending requests", seededReqs.length === 3);

  // ---- 4. send a meet to a test user -> auto-accept + reply -------------------
  const pendingFrom = new Set(seededReqs.map((r) => r.from_id));
  const freshTester = testers.map((t) => t.id).find((t) => !pendingFrom.has(t));
  await callAction(`/${eventId}/connect`, "sendIntent", [
    { targetId: freshTester, kind: "meet" },
  ]);
  const myIntent = await sql`
    select status from intents where event_id = ${eventId}
    and from_id = ${me} and to_id = ${freshTester}`;
  check("meet to test user auto-accepted", myIntent[0]?.status === "accepted");
  const [a1, b1] = me < freshTester ? [me, freshTester] : [freshTester, me];
  const conn1 = await sql`
    select id from connections where profile_a = ${a1} and profile_b = ${b1}`;
  check("connection created", conn1.length === 1);
  const reply = await sql`
    select 1 from messages where connection_id = ${conn1[0].id} and sender_id = ${freshTester}`;
  check("test user replied once in chat", reply.length === 1);

  // ---- 5. reciprocal: meet someone who already requested me --------------------
  const requester = seededReqs[0].from_id;
  await callAction(`/${eventId}/connect`, "sendIntent", [
    { targetId: requester, kind: "link" },
  ]);
  const both = await sql`
    select status from intents where event_id = ${eventId} and (
      (from_id = ${me} and to_id = ${requester}) or
      (from_id = ${requester} and to_id = ${me}))`;
  check(
    "reciprocal intents both accepted",
    both.length === 2 && both.every((r) => r.status === "accepted"),
  );

  // ---- 6. accept one pending request, decline another silently ----------------
  const inbox = await sql`
    select id, from_id from intents where event_id = ${eventId} and to_id = ${me}
    and status = 'pending' order by created_at`;
  check("requests remain in inbox", inbox.length === 2);
  await callAction(`/${eventId}/requests`, "respondToRequest", [inbox[0].id, true]);
  await callAction(`/${eventId}/requests`, "respondToRequest", [inbox[1].id, false]);
  const after = await sql`
    select id, status from intents where id in (${inbox[0].id}, ${inbox[1].id})`;
  const byId = Object.fromEntries(after.map((r) => [r.id, r.status]));
  check("accept recorded", byId[inbox[0].id] === "accepted");
  check("decline recorded (silently)", byId[inbox[1].id] === "declined");
  const [a2, b2] = me < inbox[1].from_id ? [me, inbox[1].from_id] : [inbox[1].from_id, me];
  const noConn = await sql`
    select 1 from connections where profile_a = ${a2} and profile_b = ${b2}`;
  check("declined request made no connection", noConn.length === 0);

  // ---- 7. chat + mutual "we met" ------------------------------------------------
  await callAction(`/${eventId}/chats/${conn1[0].id}`, "sendMessage", [
    conn1[0].id,
    "meet you at the north bar in 10",
  ]);
  const sent = await sql`
    select 1 from messages where connection_id = ${conn1[0].id} and sender_id = ${me}`;
  check("sendMessage persists my message", sent.length === 1);

  await callAction(`/${eventId}/chats/${conn1[0].id}`, "markMet", [conn1[0].id]);
  const metRow = await sql`
    select met_confirmed_at from connections where id = ${conn1[0].id}`;
  check(
    "'we met' confirmed (test user taps back)",
    !!metRow[0].met_confirmed_at,
  );

  // ---- 8. invite: instant chat with the invite as first message ----------------
  const inviteTarget = inbox[1].from_id; // the silent decliner — invite them anyway?
  const untouched = testers
    .map((t) => t.id)
    .find((t) => t !== freshTester && t !== requester && t !== inbox[0].from_id && t !== inbox[1].from_id);
  if (untouched) {
    await callAction(`/${eventId}/connect`, "sendIntent", [
      { targetId: untouched, kind: "invite", message: "drinks at 7 by the expo hall?" },
    ]);
    const [a3, b3] = me < untouched ? [me, untouched] : [untouched, me];
    const conn3 = await sql`
      select id from connections where profile_a = ${a3} and profile_b = ${b3}`;
    check("invite opened a connection instantly", conn3.length === 1);
    const first = await sql`
      select body, sender_id from messages where connection_id = ${conn3[0].id}
      order by created_at limit 1`;
    check(
      "invite text is the first message",
      first[0]?.body === "drinks at 7 by the expo hall?" && first[0].sender_id === me,
    );
  } else {
    check("invite: no untouched tester available (seed too small)", false);
  }
  void inviteTarget;
} catch (err) {
  ok = false;
  console.error("GOLDEN-PATH ERROR:", err);
} finally {
  if (eventId) await sql`delete from events where id = ${eventId}`;
  await sql.end();
}

process.exit(ok ? 0 : 1);
