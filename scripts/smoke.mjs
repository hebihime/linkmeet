// End-to-end smoke test of the v2 async request/accept core loop against the
// real DB. Mirrors the semantics of src/lib/actions.ts at the SQL level.
// node --env-file=.env.local scripts/smoke.mjs
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, {
  ssl: process.env.DATABASE_URL.includes("sslmode=disable") ? false : "require",
});
const id = (p = "") => p + Math.random().toString(36).slice(2, 12);

let ok = true;
const check = (label, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) ok = false;
};

const eventId = `smoke-${id()}`;
const openEventId = `smoke-open-${id()}`;
const codeEventId = `smoke-code-${id()}`;

async function ensureConnection(evt, x, y, origin) {
  const [a, b] = x < y ? [x, y] : [y, x];
  const ins = await sql`
    insert into connections (id, event_id, profile_a, profile_b, origin)
    values (${id()}, ${evt}, ${a}, ${b}, ${origin})
    on conflict (profile_a, profile_b) do nothing returning id`;
  if (ins[0]) return ins[0].id;
  const got = await sql`
    select id from connections where profile_a = ${a} and profile_b = ${b}`;
  return got[0].id;
}

try {
  // -- setup: event (already started) + three attendees -----------------------
  await sql`insert into events (id, name, starts_at)
            values (${eventId}, ${"Smoke Con"}, now() - interval '1 hour')`;
  const [alice, bob, cara] = ["alice", "bob", "cara"].map((n) => ({
    id: id(),
    event_id: eventId,
    email: `${n}@smoke.test`,
    name: n,
    tags: ["AI", "coffee"],
    solo: n !== "bob",
  }));
  await sql`insert into profiles ${sql([alice, bob, cara])}`;

  const evt = await sql`select starts_at <= now() as live from events where id = ${eventId}`;
  check("event exists and is live (starts_at gate)", evt[0]?.live === true);

  // -- 1. meet request: pending, invisible to no one but the receiver ---------
  await sql`insert into intents (id, event_id, from_id, to_id, kind, status)
            values (${id()}, ${eventId}, ${alice.id}, ${bob.id}, 'meet', 'pending')`;
  const inbox = await sql`
    select i.id from intents i
    where i.event_id = ${eventId} and i.to_id = ${bob.id}
      and i.status = 'pending' and i.kind in ('meet','link')`;
  check("meet request lands in receiver's inbox", inbox.length === 1);

  // -- 2. accept -> connection + chat -----------------------------------------
  await sql`update intents set status = 'accepted', responded_at = now()
            where id = ${inbox[0].id}`;
  const connAB = await ensureConnection(eventId, alice.id, bob.id, "meet");
  check("accept creates a connection", !!connAB);

  await sql`insert into messages (id, connection_id, sender_id, body)
            values (${id()}, ${connAB}, ${alice.id}, ${"hey! north bar?"})`;
  await sql`insert into messages (id, connection_id, sender_id, body)
            values (${id()}, ${connAB}, ${bob.id}, ${"on my way"})`;
  const msgs = await sql`
    select body from messages where connection_id = ${connAB} order by created_at`;
  check("chat holds both messages in order", msgs.length === 2 && msgs[0].body.startsWith("hey"));

  // -- 3. mutual "we met" ------------------------------------------------------
  await sql`update connections set met_a = true where id = ${connAB}`;
  await sql`update connections set met_b = true where id = ${connAB}`;
  await sql`update connections set met_confirmed_at = now()
            where id = ${connAB} and met_a and met_b and met_confirmed_at is null`;
  const met = await sql`select met_confirmed_at from connections where id = ${connAB}`;
  check("both taps confirm 'we met'", !!met[0].met_confirmed_at);

  // -- 4. silent decline: no connection, sender-visible state unchanged --------
  await sql`insert into intents (id, event_id, from_id, to_id, kind, status)
            values (${id()}, ${eventId}, ${cara.id}, ${bob.id}, 'link', 'pending')`;
  await sql`update intents set status = 'declined', responded_at = now()
            where event_id = ${eventId} and from_id = ${cara.id} and to_id = ${bob.id}`;
  const noConn = await sql`
    select 1 from connections
    where (profile_a = ${cara.id < bob.id ? cara.id : bob.id})
      and (profile_b = ${cara.id < bob.id ? bob.id : cara.id})`;
  check("decline creates no connection (silent)", noConn.length === 0);

  // -- 5. reciprocal auto-accept ------------------------------------------------
  await sql`insert into intents (id, event_id, from_id, to_id, kind, status)
            values (${id()}, ${eventId}, ${cara.id}, ${alice.id}, 'meet', 'pending')`;
  const reciprocal = await sql`
    select id from intents
    where event_id = ${eventId} and from_id = ${cara.id} and to_id = ${alice.id}
      and kind in ('meet','link') and status = 'pending'`;
  check("reciprocal pending intent detected", reciprocal.length === 1);
  await sql`insert into intents (id, event_id, from_id, to_id, kind, status, responded_at)
            values (${id()}, ${eventId}, ${alice.id}, ${cara.id}, 'link', 'accepted', now())`;
  await sql`update intents set status = 'accepted', responded_at = now()
            where id = ${reciprocal[0].id}`;
  const connAC = await ensureConnection(eventId, alice.id, cara.id, "link");
  check("reciprocal intents auto-accept into a connection", !!connAC);

  // -- 6. pass excludes from deck, dedupe on double-action ----------------------
  await sql`insert into intents (id, event_id, from_id, to_id, kind, status)
            values (${id()}, ${eventId}, ${bob.id}, ${cara.id}, 'pass', 'none')`;
  const dupe = await sql`
    insert into intents (id, event_id, from_id, to_id, kind, status)
    values (${id()}, ${eventId}, ${bob.id}, ${cara.id}, 'meet', 'pending')
    on conflict (event_id, from_id, to_id) do nothing returning id`;
  check("second intent toward same person is a no-op", dupe.length === 0);
  const deck = await sql`
    select p.id from profiles p
    where p.event_id = ${eventId} and p.id <> ${bob.id}
      and not exists (select 1 from intents i
        where i.event_id = ${eventId} and i.from_id = ${bob.id} and i.to_id = p.id)
      and not exists (select 1 from connections c
        where (c.profile_a = ${bob.id} and c.profile_b = p.id)
           or (c.profile_b = ${bob.id} and c.profile_a = p.id))`;
  check("deck excludes passed + connected people", deck.length === 0);

  // -- 6b. deck ranks shared-tag overlap first (random() only breaks ties) -----
  const hi = { id: id(), event_id: eventId, email: "hi@smoke.test", name: "hi", tags: ["AI", "coffee"], solo: false };
  const lo = { id: id(), event_id: eventId, email: "lo@smoke.test", name: "lo", tags: ["knitting"], solo: false };
  await sql`insert into profiles ${sql([hi, lo])}`;
  // bob's tags are ["AI","coffee"]: hi overlaps 2, lo overlaps 0 -> hi first.
  const ranked = await sql`
    select p.id from profiles p
    where p.event_id = ${eventId} and p.id in (${hi.id}, ${lo.id})
    order by (
      select count(*) from unnest(p.tags) as t(tag)
      where t.tag = any(array(select unnest(tags) from profiles where id = ${bob.id}))
    ) desc, random()`;
  check("deck ranks higher tag-overlap first", ranked[0]?.id === hi.id && ranked[1]?.id === lo.id);

  // -- 7. invite: instant connection with the invite as first message ----------
  const dana = {
    id: id(), event_id: eventId, email: "dana@smoke.test", name: "dana", tags: [],
  };
  await sql`insert into profiles ${sql(dana)}`;
  await sql`insert into intents (id, event_id, from_id, to_id, kind, message, status, responded_at)
            values (${id()}, ${eventId}, ${bob.id}, ${dana.id}, 'invite', ${"drinks at 7?"}, 'accepted', now())`;
  const connBD = await ensureConnection(eventId, bob.id, dana.id, "invite");
  await sql`insert into messages (id, connection_id, sender_id, body)
            values (${id()}, ${connBD}, ${bob.id}, ${"drinks at 7?"})`;
  const invite = await sql`
    select body from messages where connection_id = ${connBD} order by created_at limit 1`;
  check("invite opens a chat seeded with the invite text", invite[0]?.body === "drinks at 7?");

  // -- 8. access modes: the three gates, mirrored at the SQL level -------------
  // The main smoke event was inserted without access_mode -> legacy events
  // must land on 'roster' so nothing regresses.
  const legacy = await sql`select access_mode from events where id = ${eventId}`;
  check("events default to roster mode (legacy-safe)", legacy[0]?.access_mode === "roster");

  await sql`insert into events (id, name, access_mode)
            values (${openEventId}, ${"Smoke Open Con"}, 'open')`;
  const openRow = await sql`
    select access_mode, join_code from events where id = ${openEventId}`;
  check(
    "open mode: no join_code — email alone passes the gate",
    openRow[0]?.access_mode === "open" && openRow[0].join_code === null,
  );

  await sql`insert into events (id, name, access_mode, join_code)
            values (${codeEventId}, ${"Smoke Code Con"}, 'code', 'JOIN2026')`;
  // The login action uppercases attendee input and compares to join_code.
  const attempt = (typed) =>
    sql`select (${typed.trim().toUpperCase()} = join_code) as pass
        from events where id = ${codeEventId}`;
  const [right, wrong] = await Promise.all([attempt("join2026"), attempt("NOPE")]);
  check("code mode: shared code matches case-insensitively", right[0]?.pass === true);
  check("code mode: wrong code is rejected", wrong[0]?.pass === false);

  // roster still needs the exact triple (a leaked code without its email is useless).
  await sql`insert into access_codes (id, event_id, email, code)
            values (${id()}, ${eventId}, ${"eve@smoke.test"}, ${"EVECODE1"})`;
  const triple = await sql`
    select 1 from access_codes
    where event_id = ${eventId} and email = ${"eve@smoke.test"} and code = ${"EVECODE1"}`;
  const mismatched = await sql`
    select 1 from access_codes
    where event_id = ${eventId} and email = ${"mallory@smoke.test"} and code = ${"EVECODE1"}`;
  check("roster mode: exact (event,email,code) triple passes", triple.length === 1);
  check("roster mode: right code + wrong email fails", mismatched.length === 0);

  // The check constraint is the last line of defense on mode values.
  let rejected = false;
  try {
    await sql`insert into events (id, name, access_mode)
              values (${id()}, ${"Bad Con"}, 'vip')`;
  } catch {
    rejected = true;
  }
  check("invalid access_mode rejected by check constraint", rejected);
} catch (err) {
  ok = false;
  console.error("SMOKE ERROR:", err.message);
} finally {
  // Cascade wipes profiles/intents/connections/messages with the event.
  await sql`delete from events where id in (${eventId}, ${openEventId}, ${codeEventId})`;
  const leftovers = await sql`
    select count(*)::int as n from profiles where event_id = ${eventId}`;
  check("cascade cleanup leaves nothing behind", leftovers[0].n === 0);
  await sql.end();
}

process.exit(ok ? 0 : 1);
