import { sql } from "./db";
import { newId } from "./ids";

const NAMES = [
  "Ava Chen", "Marcus Reed", "Priya Nair", "Diego Alvarez", "Nadia Petrova",
  "Liam O'Brien", "Sofia Rossi", "Kenji Tanaka", "Amara Okafor", "Ethan Brooks",
  "Yuki Sato", "Rania Haddad", "Noah Whitfield", "Ingrid Larsen", "Mateo Silva",
  "Hana Kim", "Oliver Grant", "Zoe Martins", "Rohan Mehta", "Clara Dubois",
  "Sam Rivera", "Aisha Bello", "Theo Novak", "Mei Lin",
];

const HEADLINES = [
  "Founder — here to meet other builders",
  "Med-device sales, first time at this con",
  "Designer who'd rather talk than pitch",
  "Robotics engineer, always up for coffee",
  "VC, but mostly here for the hallway chats",
  "Biotech PhD escaping my poster session",
  "Defense contractor, secretly a jazz nerd",
  "Product lead, came alone, say hi",
  "Data scientist, terrible at small talk (working on it)",
  "Ops person keeping the whole thing running",
  "Recovering consultant, now building things",
  "Hardware startup, here for the after-parties",
];

const TAGS = [
  "AI", "climbing", "jazz", "medtech", "defense", "startups", "coffee",
  "running", "poker", "sci-fi", "cycling", "wine", "hiking", "photography",
  "robotics", "biotech", "VC", "design", "gaming", "sushi", "chess", "surfing",
];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Insert `count` realistic test attendees into an event. */
export async function seedTestUsers(eventId: string, count: number) {
  const n = Math.max(0, Math.min(50, Math.floor(count)));
  if (n === 0) return;

  const names = shuffle(NAMES);
  const rows = Array.from({ length: n }, (_, i) => {
    const id = newId();
    const name = names[i % names.length] + (i >= names.length ? ` ${i}` : "");
    const tags = shuffle(TAGS).slice(0, 2 + Math.floor(Math.random() * 3));
    return {
      id,
      event_id: eventId,
      email: `seed-${i}-${id}@linkmeet.test`,
      name,
      headline: HEADLINES[Math.floor(Math.random() * HEADLINES.length)],
      tags,
      photo_url: `https://i.pravatar.cc/400?u=${id}`,
      is_test: true,
    };
  });

  await sql`insert into profiles ${sql(rows)}`;
}

/**
 * Make about half of an event's test users "like" a real profile, so the
 * real user gets instant matches when they swipe Meet back.
 */
export async function seedTestLikes(eventId: string, realProfileId: string) {
  const testers = await sql`
    select id from profiles where event_id = ${eventId} and is_test = true`;
  if (testers.length === 0) return;

  const half = shuffle(testers.map((t) => t.id as string)).slice(
    0,
    Math.ceil(testers.length / 2),
  );
  if (half.length === 0) return;

  const rows = half.map((testerId) => ({
    swiper_id: testerId,
    target_id: realProfileId,
    event_id: eventId,
    liked: true,
  }));
  await sql`
    insert into swipes ${sql(rows)}
    on conflict (swiper_id, target_id) do nothing`;
}
