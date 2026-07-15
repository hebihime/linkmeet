// End-to-end smoke test of the core loop against the real DB.
// node --env-file=.env.local scripts/smoke.mjs
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { ssl: "require" });
const id = (p = "") => p + Math.random().toString(36).slice(2, 12);

let ok = true;
const check = (label, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) ok = false;
};

const eventId = "smoke-" + id();
try {
  await sql`insert into events (id, name) values (${eventId}, 'Smoke Test')`;

  const alice = id("p_"),
    bob = id("p_");
  await sql`insert into access_codes ${sql([
    { id: id(), event_id: eventId, email: "alice@x.com", code: "ALICE111" },
    { id: id(), event_id: eventId, email: "bob@x.com", code: "BOBBB222" },
  ])}`;
  await sql`insert into profiles ${sql([
    { id: alice, event_id: eventId, email: "alice@x.com", name: "Alice", tags: ["ai"] },
    { id: bob, event_id: eventId, email: "bob@x.com", name: "Bob", tags: ["jazz"] },
  ])}`;

  // Duplicate email must be rejected (exclusivity of one profile per attendee)
  let dupBlocked = false;
  try {
    await sql`insert into profiles ${sql([
      { id: id(), event_id: eventId, email: "alice@x.com", name: "Fake" },
    ])}`;
  } catch {
    dupBlocked = true;
  }
  check("duplicate (event,email) profile rejected", dupBlocked);

  // Alice's next card is Bob (only other attendee)
  const next1 = await sql`
    select id from profiles p where p.event_id = ${eventId} and p.id <> ${alice}
    and not exists (select 1 from swipes s where s.swiper_id=${alice} and s.target_id=p.id)
    limit 1`;
  check("Alice's deck surfaces Bob", next1[0]?.id === bob);

  // Alice likes Bob — no match yet
  await sql`insert into swipes (swiper_id,target_id,event_id,liked) values (${alice},${bob},${eventId},true)`;
  const backForAlice = await sql`select 1 from swipes where swiper_id=${bob} and target_id=${alice} and liked=true limit 1`;
  check("no match after one-sided like", backForAlice.length === 0);

  // Bob likes Alice — mutual → match
  await sql`insert into swipes (swiper_id,target_id,event_id,liked) values (${bob},${alice},${eventId},true)`;
  const back = await sql`select 1 from swipes where swiper_id=${alice} and target_id=${bob} and liked=true limit 1`;
  if (back.length > 0) {
    const [a, b] = alice < bob ? [alice, bob] : [bob, alice];
    await sql`insert into matches (id,event_id,profile_a,profile_b) values (${id()},${eventId},${a},${b}) on conflict (profile_a,profile_b) do nothing`;
  }
  const matches = await sql`select 1 from matches where event_id=${eventId}`;
  check("mutual like creates exactly one match", matches.length === 1);

  // Alice's deck is now empty (Bob already swiped)
  const next2 = await sql`
    select id from profiles p where p.event_id = ${eventId} and p.id <> ${alice}
    and not exists (select 1 from swipes s where s.swiper_id=${alice} and s.target_id=p.id)
    limit 1`;
  check("deck empty after swiping everyone", next2.length === 0);
} finally {
  await sql`delete from events where id = ${eventId}`; // cascades
  await sql.end();
}

console.log(ok ? "\nALL PASS" : "\nFAILURES");
process.exit(ok ? 0 : 1);
