// Verifies seed users + pre-likes + match interaction against the real DB.
// node --env-file=.env.local scripts/seed-smoke.mjs
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", onnotice: () => {} });
const id = (p = "") => p + Math.random().toString(36).slice(2, 12);

let ok = true;
const check = (label, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) ok = false;
};

const eventId = "seedsmoke-" + id();
try {
  await sql`insert into events (id, name) values (${eventId}, 'Seed Smoke')`;

  // Seed 10 test users
  const N = 10;
  const testers = Array.from({ length: N }, (_, i) => ({
    id: id("t_"),
    event_id: eventId,
    email: `seed-${i}-${id()}@linkmeet.test`,
    name: `Tester ${i}`,
    tags: ["ai"],
    photo_url: `https://i.pravatar.cc/400?u=${i}`,
    is_test: true,
  }));
  await sql`insert into profiles ${sql(testers)}`;

  const seededCount = (
    await sql`select count(*)::int as c from profiles where event_id=${eventId} and is_test=true`
  )[0].c;
  check("seeded exactly 10 test users", seededCount === 10);

  // Real user joins
  const alice = id("p_");
  await sql`insert into profiles ${sql([
    { id: alice, event_id: eventId, email: "alice@x.com", name: "Alice", tags: ["vc"] },
  ])}`;

  // seedTestLikes: ceil(N/2) test users like Alice
  const half = testers.map((t) => t.id).slice(0, Math.ceil(N / 2));
  await sql`insert into swipes ${sql(
    half.map((t) => ({ swiper_id: t, target_id: alice, event_id: eventId, liked: true })),
  )} on conflict (swiper_id,target_id) do nothing`;
  check("half (5) test users pre-liked Alice", half.length === 5);

  // Alice's deck should show all 10 testers (not herself)
  const deck = await sql`
    select count(*)::int as c from profiles p where p.event_id=${eventId} and p.id<>${alice}
    and not exists (select 1 from swipes s where s.swiper_id=${alice} and s.target_id=p.id)`;
  check("Alice's deck has all 10 test users", deck[0].c === 10);

  // Alice swipes Meet on every tester; mutual with the 5 who pre-liked
  let matches = 0;
  for (const t of testers) {
    await sql`insert into swipes (swiper_id,target_id,event_id,liked) values (${alice},${t.id},${eventId},true)
      on conflict (swiper_id,target_id) do update set liked=true`;
    const back = await sql`select 1 from swipes where swiper_id=${t.id} and target_id=${alice} and liked=true limit 1`;
    if (back.length > 0) {
      const [a, b] = alice < t.id ? [alice, t.id] : [t.id, alice];
      const r = await sql`insert into matches (id,event_id,profile_a,profile_b)
        values (${id()},${eventId},${a},${b}) on conflict (profile_a,profile_b) do nothing returning id`;
      if (r.length > 0) matches++;
    }
  }
  check("Alice matches exactly the 5 who pre-liked her", matches === 5);
} finally {
  await sql`delete from events where id=${eventId}`;
  await sql.end();
}

console.log(ok ? "\nALL PASS" : "\nFAILURES");
process.exit(ok ? 0 : 1);
