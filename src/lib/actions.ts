"use server";

import { redirect } from "next/navigation";
import { sql } from "./db";
import { getSession, setSession } from "./session";
import { makeEventId, newId, newCode, normalizeEmail } from "./ids";
import { getNextCard, type Card } from "./queries";
import { seedTestUsers, seedTestLikes } from "./seed";

// ---- Create event + pre-bound codes ---------------------------------------

export type CreatedEvent = {
  eventId: string;
  name: string;
  codes: { email: string; code: string }[];
};

export async function createEvent(
  name: string,
  emailsRaw: string,
  seedCount = 0,
): Promise<{ error: string } | CreatedEvent> {
  const cleanName = name.trim();
  if (!cleanName) return { error: "Event name is required." };

  const emails = Array.from(
    new Set(
      emailsRaw
        .split(/[\n,;]+/)
        .map(normalizeEmail)
        .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)),
    ),
  );
  if (emails.length === 0)
    return { error: "Add at least one valid attendee email." };

  const eventId = makeEventId(cleanName);
  await sql`insert into events (id, name) values (${eventId}, ${cleanName})`;

  const codes = emails.map((email) => ({ email, code: newCode() }));
  await sql`
    insert into access_codes ${sql(
      codes.map((c) => ({
        id: newId(),
        event_id: eventId,
        email: c.email,
        code: c.code,
      })),
    )}
  `;

  if (seedCount > 0) await seedTestUsers(eventId, seedCount);

  return { eventId, name: cleanName, codes };
}

// ---- Login (email + pre-bound code) ---------------------------------------

export async function login(
  eventId: string,
  emailRaw: string,
  codeRaw: string,
): Promise<{ error: string } | { ok: true; hasProfile: boolean }> {
  const email = normalizeEmail(emailRaw);
  const code = codeRaw.trim().toUpperCase();
  if (!email || !code) return { error: "Enter your email and code." };

  const rows = await sql`
    select id, claimed_at from access_codes
    where event_id = ${eventId} and email = ${email} and code = ${code}
    limit 1`;
  if (rows.length === 0)
    return { error: "That email and code don't match for this event." };

  if (!rows[0].claimed_at) {
    await sql`update access_codes set claimed_at = now() where id = ${rows[0].id}`;
  }

  const existing = await sql`
    select id from profiles where event_id = ${eventId} and email = ${email} limit 1`;
  const profileId = existing[0]?.id as string | undefined;

  await setSession({ eventId, email, profileId });
  return { ok: true, hasProfile: !!profileId };
}

// ---- Save profile ----------------------------------------------------------

export async function saveProfile(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/");

  const name = String(formData.get("name") ?? "").trim();
  const headline = String(formData.get("headline") ?? "").trim() || null;
  const photo_url = String(formData.get("photo_url") ?? "").trim() || null;
  const tags = String(formData.get("tags") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8);

  if (!name) return; // name is required; the form enforces it client-side too

  const isFirstProfile = !session.profileId;

  const rows = await sql`
    insert into profiles (id, event_id, email, name, headline, tags, photo_url)
    values (${newId()}, ${session.eventId}, ${session.email}, ${name}, ${headline}, ${tags}, ${photo_url})
    on conflict (event_id, email) do update
      set name = excluded.name,
          headline = excluded.headline,
          tags = excluded.tags,
          photo_url = excluded.photo_url
    returning id`;

  const profileId = rows[0].id as string;

  // First time this attendee sets up: let ~half the seeded test users "like"
  // them, so swiping Meet produces instant matches to test the flow.
  if (isFirstProfile) await seedTestLikes(session.eventId, profileId);

  await setSession({ ...session, profileId });
  redirect(`/${session.eventId}/deck`);
}

// ---- Swipe -----------------------------------------------------------------

export type SwipeResult = {
  match: { id: string; name: string; headline: string | null } | null;
  next: Card | null;
};

export async function swipe(
  targetId: string,
  liked: boolean,
): Promise<SwipeResult> {
  const session = await getSession();
  if (!session?.profileId) return { match: null, next: null };
  const me = session.profileId;

  await sql`
    insert into swipes (swiper_id, target_id, event_id, liked)
    values (${me}, ${targetId}, ${session.eventId}, ${liked})
    on conflict (swiper_id, target_id) do update set liked = excluded.liked`;

  let match: SwipeResult["match"] = null;

  if (liked) {
    const back = await sql`
      select 1 from swipes
      where swiper_id = ${targetId} and target_id = ${me} and liked = true limit 1`;
    if (back.length > 0) {
      const [a, b] = me < targetId ? [me, targetId] : [targetId, me];
      await sql`
        insert into matches (id, event_id, profile_a, profile_b)
        values (${newId()}, ${session.eventId}, ${a}, ${b})
        on conflict (profile_a, profile_b) do nothing`;

      const target = await sql`
        select id, name, headline from profiles where id = ${targetId} limit 1`;
      if (target[0])
        match = {
          id: target[0].id as string,
          name: target[0].name as string,
          headline: (target[0].headline as string | null) ?? null,
        };
    }
  }

  const next = (await getNextCard(session.eventId, me)) ?? null;
  return { match, next };
}
