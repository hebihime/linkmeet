// Golden-path test: drives the REAL server actions over HTTP (the same wire
// protocol the browser uses) against a running `next start` + real Neon.
// Covers: create event -> login -> save profile -> seeded requests ->
// send meet (test auto-accept) -> accept request -> chat -> mutual "we met".
// Usage: npm run build && npx next start -p 3999 &
//        node --env-file=.env.local scripts/golden-path.mjs
import postgres from "postgres";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3999";
const sql = postgres(process.env.DATABASE_URL, {
  ssl: process.env.DATABASE_URL.includes("sslmode=disable") ? false : "require",
});

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
const extraEvents = []; // open/code events created in step 9, cleaned up after

try {
  // ---- 1. create event (with seeded test attendees) --------------------------
  const create = await callAction("/new", "createEvent", [
    {
      name: "Golden Path Con",
      startsAtIso: new Date().toISOString(), // starts now -> Connect is live
      accessMode: "roster",
      emails: EMAIL,
      seedCount: 6,
    },
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

  // ---- 3. save profile: 18+ gate + moderation bounce first --------------------
  const under18 = new Date();
  under18.setFullYear(under18.getFullYear() - 16);
  const baseProfile = {
    name: "Golden Tester",
    headline: "Here to verify everything",
    tags: "AI, coffee",
    photos: JSON.stringify(["https://i.pravatar.cc/300?img=68"]),
    solo: "on",
    birth_date: "1990-06-15",
    adult: "on",
  };
  const bounceMinor = await callFormAction(`/${eventId}/profile`, "saveProfile", {
    ...baseProfile,
    birth_date: under18.toISOString().slice(0, 10),
  });
  check("under-18 DOB bounces (no redirect)", bounceMinor.status !== 303);
  const bounceAttest = await callFormAction(`/${eventId}/profile`, "saveProfile", {
    ...baseProfile,
    adult: "",
  });
  check("missing 18+ attestation bounces", bounceAttest.status !== 303);
  const bounceTag = await callFormAction(`/${eventId}/profile`, "saveProfile", {
    ...baseProfile,
    tags: "AI, n4z1",
  });
  check("unsafe tag bounces (leetspeak normalized)", bounceTag.status !== 303);
  const bounceHeadline = await callFormAction(`/${eventId}/profile`, "saveProfile", {
    ...baseProfile,
    headline: "Total asshole energy",
  });
  check("unsafe headline bounces", bounceHeadline.status !== 303);
  const noRow = await sql`
    select 1 from profiles where event_id = ${eventId} and email = ${EMAIL}`;
  check("bounced saves created no profile row", noRow.length === 0);

  // ---- 3b. clean 18+ save goes through ----------------------------------------
  const save = await callFormAction(`/${eventId}/profile`, "saveProfile", baseProfile);
  check("saveProfile redirects to explore", save.status === 303);
  const meRow = await sql`
    select id, solo, birth_date::text as birth_date
    from profiles where event_id = ${eventId} and email = ${EMAIL}`;
  const me = meRow[0]?.id;
  check("profile row created with solo flag", !!me && meRow[0].solo === true);
  check("birth_date persisted", meRow[0]?.birth_date === "1990-06-15");

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

  // ---- 7. chat + QR-verified "we met" -----------------------------------------
  await callAction(`/${eventId}/chats/${conn1[0].id}`, "sendMessage", [
    conn1[0].id,
    "meet you at the north bar in 10",
  ]);
  const sent = await sql`
    select 1 from messages where connection_id = ${conn1[0].id} and sender_id = ${me}`;
  check("sendMessage persists my message", sent.length === 1);

  // Rating before any meet must bounce.
  await callAction(`/${eventId}/chats/${conn1[0].id}`, "submitRating", [
    conn1[0].id, true, ["great_conversation"],
  ]);
  const earlyRating = await sql`
    select 1 from ratings where connection_id = ${conn1[0].id}`;
  check("rating before verified meet is rejected", earlyRating.length === 0);

  // Mint a meet token; the test-user counterparty auto-scans server-side.
  await callAction(`/${eventId}/chats/${conn1[0].id}`, "mintMeetToken", [
    conn1[0].id, { lat: 37.7749, lng: -122.4194 },
  ]);
  const metRow = await sql`
    select met_confirmed_at, met_method, met_confidence, met_a, met_b
    from connections where id = ${conn1[0].id}`;
  check(
    "QR meet verified (test-user bypass): both flags + confirmed",
    !!metRow[0].met_confirmed_at && metRow[0].met_a && metRow[0].met_b,
  );
  check("met_method = 'qr' with a confidence score",
    metRow[0].met_method === "qr" && metRow[0].met_confidence != null);

  // Verified meet unlocks rating; one per connection.
  await callAction(`/${eventId}/chats/${conn1[0].id}`, "submitRating", [
    conn1[0].id, true, ["great_conversation", "not_a_real_key"],
  ]);
  const rating = await sql`
    select endorse, positives, ratee_id from ratings
    where connection_id = ${conn1[0].id} and rater_id = ${me}`;
  check(
    "verified meet unlocks rating (unknown chips dropped)",
    rating.length === 1 && rating[0].endorse === true &&
      rating[0].positives.length === 1 && rating[0].ratee_id === freshTester,
  );

  // ---- 7b. soft honor tap stays cosmetic: confirms, but unlocks nothing -------
  const [a4, b4] = me < inbox[0].from_id ? [me, inbox[0].from_id] : [inbox[0].from_id, me];
  const connSoft = await sql`
    select id from connections where profile_a = ${a4} and profile_b = ${b4}`;
  await callAction(`/${eventId}/chats/${connSoft[0].id}`, "markMet", [connSoft[0].id]);
  const softRow = await sql`
    select met_confirmed_at, met_method from connections where id = ${connSoft[0].id}`;
  check(
    "honor tap still confirms (test user taps back) but stays unverified",
    !!softRow[0].met_confirmed_at && softRow[0].met_method === null,
  );
  await callAction(`/${eventId}/chats/${connSoft[0].id}`, "submitRating", [
    connSoft[0].id, true, [],
  ]);
  const softRating = await sql`
    select 1 from ratings where connection_id = ${connSoft[0].id}`;
  check("unverified meet does NOT unlock rating", softRating.length === 0);

  // ---- 7c. safety report + auto-suspend threshold ------------------------------
  // Two prior distinct reporters (seeded directly), then my report crosses the
  // 3-reporter threshold and auto-suspends pending review.
  const reporters = testers.map((t) => t.id).filter((t) => t !== freshTester).slice(0, 2);
  for (const r of reporters) {
    await sql`
      insert into safety_reports (id, reporter_id, reported_id, reason)
      values (${"gp" + Math.random().toString(36).slice(2, 10)}, ${r}, ${freshTester}, 'harassment')`;
  }
  await callAction(`/${eventId}/chats/${conn1[0].id}`, "submitSafetyReport", [
    conn1[0].id, "safety", "golden-path test report",
  ]);
  // Report keys on reporter/reported, not connection_id: the report also
  // deletes the conversation, which nulls the report's connection_id.
  const myReport = await sql`
    select 1 from safety_reports
    where reporter_id = ${me} and reported_id = ${freshTester}`;
  check("safety report persisted", myReport.length === 1);
  const suspended = await sql`
    select suspended_at from profiles where id = ${freshTester}`;
  check("3 distinct reporters auto-suspend the profile", !!suspended[0].suspended_at);
  const deckAfter = await sql`
    select 1 from profiles p
    where p.event_id = ${eventId} and p.id = ${freshTester} and p.suspended_at is null`;
  check("suspended profile is out of the deck pool", deckAfter.length === 0);

  // ---- 7d. reporting = block + delete the conversation -------------------------
  const goneConn = await sql`select 1 from connections where id = ${conn1[0].id}`;
  check("report deletes the conversation", goneConn.length === 0);
  const goneMsgs = await sql`select 1 from messages where connection_id = ${conn1[0].id}`;
  check("report deletes the conversation's messages", goneMsgs.length === 0);
  const blocks = await sql`
    select from_id, to_id from intents
    where event_id = ${eventId} and kind = 'pass'
      and ((from_id = ${me} and to_id = ${freshTester})
        or (from_id = ${freshTester} and to_id = ${me}))`;
  check("report blocks both directions (bidirectional pass)", blocks.length === 2);
  // The blocked pair can't resurface in each other's decks.
  const inMyDeck = await sql`
    select 1 from profiles p
    where p.event_id = ${eventId} and p.id = ${freshTester}
      and not exists (select 1 from intents i
        where i.event_id = ${eventId} and i.from_id = ${me} and i.to_id = p.id)`;
  check("blocked profile can't reappear in my deck", inMyDeck.length === 0);

  // ---- 8. invite to a TEST user: auto-accepted, opens the chat instantly -------
  // (Test targets auto-accept so the loop stays solo-testable; real targets go
  // through the consent gate in 8b.)
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
    check("invite to a test user opens a connection instantly", conn3.length === 1);
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

  // ---- 8b. invite to a REAL user: consent-gated request, not an instant chat ---
  // A real target must accept before the thread opens; the inviter's message is
  // seeded as the first message on accept. Simulate by dropping a pending invite
  // from a fresh tester into my inbox, then accepting it as me.
  const eligible = await sql`
    select t.id from profiles t
    where t.event_id = ${eventId} and t.is_test = true and t.id <> ${me}
      and not exists (select 1 from intents i where i.event_id = ${eventId}
        and ((i.from_id = t.id and i.to_id = ${me}) or (i.from_id = ${me} and i.to_id = t.id)))
      and not exists (select 1 from connections c where
        (c.profile_a = ${me} and c.profile_b = t.id) or (c.profile_b = ${me} and c.profile_a = t.id))
    limit 1`;
  const inviter = eligible[0]?.id;
  if (inviter) {
    const invId = "gp" + Math.random().toString(36).slice(2, 10);
    await sql`
      insert into intents (id, event_id, from_id, to_id, kind, message, status)
      values (${invId}, ${eventId}, ${inviter}, ${me}, 'invite', ${"coffee before the keynote?"}, 'pending')`;
    const [ia, ib] = me < inviter ? [me, inviter] : [inviter, me];
    const preConn = await sql`
      select 1 from connections where profile_a = ${ia} and profile_b = ${ib}`;
    check("pending invite opens NO connection until accepted", preConn.length === 0);

    await callAction(`/${eventId}/requests`, "respondToRequest", [invId, true]);
    const invConn = await sql`
      select id from connections where profile_a = ${ia} and profile_b = ${ib}`;
    check("accepting an invite opens the connection", invConn.length === 1);
    const invFirst = await sql`
      select body, sender_id from messages where connection_id = ${invConn[0]?.id}
      order by created_at limit 1`;
    check(
      "accepted invite seeds the inviter's message first",
      invFirst[0]?.body === "coffee before the keynote?" && invFirst[0]?.sender_id === inviter,
    );

    // ---- 8c. unread cursor: the seeded message is unread until I open it -------
    const unreadFor = async (connId) => {
      const r = await sql`
        select count(*)::int as n from connections c
        where c.id = ${connId}
          and exists (select 1 from messages um where um.connection_id = c.id
            and um.sender_id <> ${me}
            and ((c.profile_a = ${me} and (c.read_a is null or um.created_at > c.read_a))
              or (c.profile_b = ${me} and (c.read_b is null or um.created_at > c.read_b))))`;
      return r[0].n;
    };
    check("invite message is unread before I open the thread", (await unreadFor(invConn[0].id)) === 1);
    await callAction(`/${eventId}/chats/${invConn[0].id}`, "fetchThread", [invConn[0].id]);
    check("opening the thread clears its unread", (await unreadFor(invConn[0].id)) === 0);
  } else {
    check("invite-as-request: no eligible tester (seed too small)", false);
  }

  // ---- 9. the other two access modes, over the wire ----------------------------
  // open: email alone gets a session.
  await callAction("/new", "createEvent", [
    {
      name: "Golden Open Con",
      startsAtIso: new Date().toISOString(),
      accessMode: "open",
      seedCount: 0,
    },
  ]);
  const openEvt = (
    await sql`select id, access_mode, join_code from events
              where name = 'Golden Open Con' order by created_at desc limit 1`
  )[0];
  if (openEvt) extraEvents.push(openEvt.id);
  check(
    "open event created (no join_code)",
    openEvt?.access_mode === "open" && openEvt.join_code === null,
  );
  cookie = "";
  await callAction(`/${openEvt.id}`, "login", [openEvt.id, "walkup@e2e.test", ""]);
  check("open login: email alone sets a session", cookie.startsWith("lm_session="));

  // code: the shared join code gates entry; wrong code doesn't.
  await callAction("/new", "createEvent", [
    {
      name: "Golden Code Con",
      startsAtIso: new Date().toISOString(),
      accessMode: "code",
      joinCode: "golden99", // lowercase on purpose — stored uppercased
      seedCount: 0,
    },
  ]);
  const codeEvt = (
    await sql`select id, access_mode, join_code from events
              where name = 'Golden Code Con' order by created_at desc limit 1`
  )[0];
  if (codeEvt) extraEvents.push(codeEvt.id);
  check(
    "code event stores the uppercased join code",
    codeEvt?.access_mode === "code" && codeEvt.join_code === "GOLDEN99",
  );
  cookie = "";
  await callAction(`/${codeEvt.id}`, "login", [codeEvt.id, "door@e2e.test", "WRONG1"]);
  check("code login: wrong code sets no session", cookie === "");
  await callAction(`/${codeEvt.id}`, "login", [codeEvt.id, "door@e2e.test", "golden99"]);
  check(
    "code login: right code (any case) sets a session",
    cookie.startsWith("lm_session="),
  );
} catch (err) {
  ok = false;
  console.error("GOLDEN-PATH ERROR:", err);
} finally {
  if (eventId) await sql`delete from events where id = ${eventId}`;
  for (const id of extraEvents) await sql`delete from events where id = ${id}`;
  await sql.end();
}

process.exit(ok ? 0 : 1);
