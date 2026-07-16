"use server";

import { redirect } from "next/navigation";
import { sql } from "./db";
import { getSession, setSession, type Session } from "./session";
import { makeEventId, newId, newCode, normalizeEmail } from "./ids";
import { getDeckCards, getMessages, type Card, type Message } from "./queries";
import { seedTestUsers, seedTestRequests, testUserReply } from "./seed";

// ---- Create event + pre-bound codes ---------------------------------------

export type CreatedEvent = {
  eventId: string;
  name: string;
  codes: { email: string; code: string }[];
};

export async function createEvent(
  name: string,
  startsAtIso: string,
  emailsRaw: string,
  seedCount = 0,
): Promise<{ error: string } | CreatedEvent> {
  const cleanName = name.trim();
  if (!cleanName) return { error: "Event name is required." };

  const startsAt = new Date(startsAtIso);
  if (isNaN(startsAt.getTime()))
    return { error: "Pick a valid start date & time." };

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
  await sql`
    insert into events (id, name, starts_at)
    values (${eventId}, ${cleanName}, ${startsAt})`;

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
  const solo = formData.get("solo") === "on";
  const tags = String(formData.get("tags") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8);

  if (!name) return; // name is required; the form enforces it client-side too

  const isFirstProfile = !session.profileId;

  const rows = await sql`
    insert into profiles (id, event_id, email, name, headline, tags, photo_url, solo)
    values (${newId()}, ${session.eventId}, ${session.email}, ${name}, ${headline}, ${tags}, ${photo_url}, ${solo})
    on conflict (event_id, email) do update
      set name = excluded.name,
          headline = excluded.headline,
          tags = excluded.tags,
          photo_url = excluded.photo_url,
          solo = excluded.solo
    returning id`;

  const profileId = rows[0].id as string;

  // First time this attendee sets up: seed pending requests from ~half the
  // test users so the Requests inbox has content immediately.
  if (isFirstProfile) await seedTestRequests(session.eventId, profileId);

  await setSession({ ...session, profileId });
  redirect(`/${session.eventId}/explore`);
}

// ---- The async request/accept model ----------------------------------------

export type IntentKind = "meet" | "link" | "invite" | "pass";

export type Celebration = {
  connectionId: string;
  name: string;
  photoUrl: string | null;
};

export type SendIntentResult = { celebration: Celebration | null };

async function requireProfile(): Promise<(Session & { profileId: string }) | null> {
  const session = await getSession();
  if (!session?.profileId) return null;
  return session as Session & { profileId: string };
}

// Canonical-pair connection. Returns the connection id whether it was just
// created or already existed.
async function ensureConnection(
  eventId: string,
  x: string,
  y: string,
  origin: string,
): Promise<string> {
  const [a, b] = x < y ? [x, y] : [y, x];
  const inserted = await sql`
    insert into connections (id, event_id, profile_a, profile_b, origin)
    values (${newId()}, ${eventId}, ${a}, ${b}, ${origin})
    on conflict (profile_a, profile_b) do nothing
    returning id`;
  if (inserted[0]) return inserted[0].id as string;
  const existing = await sql`
    select id from connections where profile_a = ${a} and profile_b = ${b} limit 1`;
  return existing[0].id as string;
}

export async function sendIntent(input: {
  targetId: string;
  kind: IntentKind;
  message?: string;
  photoUrl?: string;
}): Promise<SendIntentResult> {
  const none: SendIntentResult = { celebration: null };
  const session = await requireProfile();
  if (!session) return none;
  const me = session.profileId;
  const { targetId, kind } = input;
  if (targetId === me) return none;

  const targetRows = await sql`
    select id, name, photo_url, is_test from profiles
    where id = ${targetId} and event_id = ${session.eventId} limit 1`;
  const target = targetRows[0];
  if (!target) return none;

  const celebration: Celebration = {
    connectionId: "",
    name: target.name as string,
    photoUrl: (target.photo_url as string | null) ?? null,
  };

  if (kind === "pass") {
    await sql`
      insert into intents (id, event_id, from_id, to_id, kind, status)
      values (${newId()}, ${session.eventId}, ${me}, ${targetId}, 'pass', 'none')
      on conflict (event_id, from_id, to_id) do nothing`;
    return none;
  }

  if (kind === "invite") {
    const message = (input.message ?? "").trim();
    if (!message) return none;
    const photoUrl = (input.photoUrl ?? "").trim() || null;

    const inserted = await sql`
      insert into intents (id, event_id, from_id, to_id, kind, message, photo_url, status, responded_at)
      values (${newId()}, ${session.eventId}, ${me}, ${targetId}, 'invite', ${message}, ${photoUrl}, 'accepted', now())
      on conflict (event_id, from_id, to_id) do nothing
      returning id`;
    if (!inserted[0]) return none; // already acted on this person

    const connectionId = await ensureConnection(
      session.eventId,
      me,
      targetId,
      "invite",
    );
    // The invite IS the first message; an attached photo goes in as a
    // follow-up image message (the thread renders bare image URLs inline).
    await sql`
      insert into messages (id, connection_id, sender_id, body)
      values (${newId()}, ${connectionId}, ${me}, ${message})`;
    if (photoUrl) {
      await sql`
        insert into messages (id, connection_id, sender_id, body)
        values (${newId()}, ${connectionId}, ${me}, ${photoUrl})`;
    }
    if (target.is_test) await testUserReply(connectionId, targetId);
    return none; // invites open a thread quietly — no celebration overlay
  }

  // meet / link — the async request flow.
  // Reciprocal auto-accept: if they already have a pending meet/link toward
  // me, both sides accept instantly. (Also covers test users, who auto-accept
  // everything so the whole loop is testable solo.)
  const reciprocal = await sql`
    select id from intents
    where event_id = ${session.eventId} and from_id = ${targetId} and to_id = ${me}
      and kind in ('meet','link') and status = 'pending'
    limit 1`;
  const autoAccept = reciprocal.length > 0 || (target.is_test as boolean);

  const inserted = await sql`
    insert into intents (id, event_id, from_id, to_id, kind, status, responded_at)
    values (${newId()}, ${session.eventId}, ${me}, ${targetId}, ${kind},
            ${autoAccept ? "accepted" : "pending"},
            ${autoAccept ? new Date() : null})
    on conflict (event_id, from_id, to_id) do nothing
    returning id`;
  if (!inserted[0]) return none; // already acted on this person

  if (!autoAccept) return none; // pending request; receiver decides

  if (reciprocal[0]) {
    await sql`
      update intents set status = 'accepted', responded_at = now()
      where id = ${reciprocal[0].id}`;
  }
  const connectionId = await ensureConnection(session.eventId, me, targetId, kind);
  if (target.is_test) await testUserReply(connectionId, targetId);

  celebration.connectionId = connectionId;
  return { celebration };
}

// Background refill for the deck's prefetch queue.
export async function fetchMoreCards(exclude: string[]): Promise<Card[]> {
  const session = await requireProfile();
  if (!session) return [];
  return getDeckCards(session.eventId, session.profileId, exclude, 12);
}

// ---- Requests inbox ---------------------------------------------------------

export async function respondToRequest(
  intentId: string,
  accept: boolean,
): Promise<{ connectionId: string | null }> {
  const session = await requireProfile();
  if (!session) return { connectionId: null };
  const me = session.profileId;

  const rows = await sql`
    update intents
    set status = ${accept ? "accepted" : "declined"}, responded_at = now()
    where id = ${intentId} and to_id = ${me} and status = 'pending'
      and kind in ('meet','link')
    returning from_id, kind, event_id`;
  const intent = rows[0];
  if (!intent || !accept) return { connectionId: null }; // declines are silent

  const connectionId = await ensureConnection(
    intent.event_id as string,
    me,
    intent.from_id as string,
    intent.kind as string,
  );

  const sender = await sql`
    select is_test from profiles where id = ${intent.from_id} limit 1`;
  if (sender[0]?.is_test)
    await testUserReply(connectionId, intent.from_id as string);

  return { connectionId };
}

// ---- Chat --------------------------------------------------------------------

async function myConnection(connectionId: string, me: string) {
  const rows = await sql`
    select id, event_id, profile_a, profile_b, met_a, met_b, met_confirmed_at
    from connections
    where id = ${connectionId} and (profile_a = ${me} or profile_b = ${me})
    limit 1`;
  return rows[0];
}

export type MetState = {
  iMet: boolean;
  theyMet: boolean;
  confirmed: boolean;
};

export type ThreadState = { messages: Message[]; met: MetState };

export async function fetchThread(
  connectionId: string,
): Promise<ThreadState | null> {
  const session = await requireProfile();
  if (!session) return null;
  const conn = await myConnection(connectionId, session.profileId);
  if (!conn) return null;

  const amA = conn.profile_a === session.profileId;
  const messages = await getMessages(connectionId);
  return {
    messages,
    met: {
      iMet: (amA ? conn.met_a : conn.met_b) as boolean,
      theyMet: (amA ? conn.met_b : conn.met_a) as boolean,
      confirmed: !!conn.met_confirmed_at,
    },
  };
}

export async function sendMessage(
  connectionId: string,
  bodyRaw: string,
): Promise<Message | null> {
  const session = await requireProfile();
  if (!session) return null;
  const body = bodyRaw.trim().slice(0, 2000);
  if (!body) return null;
  const conn = await myConnection(connectionId, session.profileId);
  if (!conn) return null;

  const rows = await sql`
    insert into messages (id, connection_id, sender_id, body)
    values (${newId()}, ${connectionId}, ${session.profileId}, ${body})
    returning id, sender_id, body, created_at`;
  return rows[0] as unknown as Message;
}

// "We met" — each side taps once; both taps = confirmed. Test users tap back
// immediately so the confirmation is testable solo.
export async function markMet(connectionId: string): Promise<MetState | null> {
  const session = await requireProfile();
  if (!session) return null;
  const me = session.profileId;
  const conn = await myConnection(connectionId, me);
  if (!conn) return null;

  const otherId = (conn.profile_a === me ? conn.profile_b : conn.profile_a) as string;
  const other = await sql`
    select is_test from profiles where id = ${otherId} limit 1`;
  const otherIsTest = !!other[0]?.is_test;

  const rows = await sql`
    update connections set
      met_a = met_a or (profile_a = ${me}) or (${otherIsTest} and profile_a = ${otherId}),
      met_b = met_b or (profile_b = ${me}) or (${otherIsTest} and profile_b = ${otherId})
    where id = ${connectionId}
    returning profile_a, profile_b, met_a, met_b, met_confirmed_at`;
  const updated = rows[0];

  let confirmedAt = updated.met_confirmed_at as Date | null;
  if (updated.met_a && updated.met_b && !confirmedAt) {
    const confirmed = await sql`
      update connections set met_confirmed_at = now()
      where id = ${connectionId} and met_confirmed_at is null
      returning met_confirmed_at`;
    confirmedAt = (confirmed[0]?.met_confirmed_at as Date | null) ?? new Date();
  }

  const amA = updated.profile_a === me;
  return {
    iMet: (amA ? updated.met_a : updated.met_b) as boolean,
    theyMet: (amA ? updated.met_b : updated.met_a) as boolean,
    confirmed: !!confirmedAt,
  };
}
