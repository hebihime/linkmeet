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

const REPLIES = [
  "Hey! Glad this went through — where are you right now?",
  "Oh nice, was hoping you'd reach out. Coffee near the main hall?",
  "Hey hey. I'm around all afternoon if you want to grab a seat somewhere.",
  "Perfect timing, I was just about to bail on this session. Meet up?",
  "Hi! I'm by the expo floor entrance — easy to find, tall coffee in hand.",
  "Love it. I've got 30 free at the top of the hour if that works?",
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
      solo: Math.random() < 0.4,
      is_test: true,
    };
  });

  await sql`insert into profiles ${sql(rows)}`;
}

/**
 * Have ~half of an event's test users send the real attendee a pending
 * Meet/Link request, so the Requests inbox has content to accept/decline
 * right away.
 */
export async function seedTestRequests(eventId: string, realProfileId: string) {
  const testers = await sql`
    select id from profiles where event_id = ${eventId} and is_test = true`;
  if (testers.length === 0) return;

  const half = shuffle(testers.map((t) => t.id as string)).slice(
    0,
    Math.ceil(testers.length / 2),
  );
  if (half.length === 0) return;

  const rows = half.map((testerId, i) => ({
    id: newId(),
    event_id: eventId,
    from_id: testerId,
    to_id: realProfileId,
    kind: i % 3 === 0 ? "meet" : "link",
    status: "pending",
  }));
  await sql`
    insert into intents ${sql(rows)}
    on conflict (event_id, from_id, to_id) do nothing`;
}

/**
 * One canned reply from a test user in a fresh connection, so chat + polling
 * are testable solo. No-op if the test user already spoke.
 */
export async function testUserReply(connectionId: string, testUserId: string) {
  const body = REPLIES[Math.floor(Math.random() * REPLIES.length)];
  await sql`
    insert into messages (id, connection_id, sender_id, body)
    select ${newId()}, ${connectionId}, ${testUserId}, ${body}
    where not exists (
      select 1 from messages
      where connection_id = ${connectionId} and sender_id = ${testUserId}
    )`;
}
