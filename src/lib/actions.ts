"use server";

import { redirect } from "next/navigation";
import { sql } from "./db";
import { getSession, setSession, type Session } from "./session";
import { makeEventId, newId, newCode, normalizeEmail } from "./ids";
import { getDeckCards, getMessages, type Card, type Message } from "./queries";
import type { DeckFilters } from "./filters";
import { seedTestUsers, seedTestRequests, testUserReply } from "./seed";

// ---- Create event (three access modes) ------------------------------------

export type AccessMode = "open" | "code" | "roster";

export type CreateEventInput = {
  name: string;
  startsAtIso: string;
  accessMode: AccessMode;
  logoUrl?: string | null; // finder carousel logo; null -> initials placeholder
  joinCode?: string; // 'code' mode; blank -> auto-generate
  emails?: string; // 'roster' mode; newline/comma separated
  seedCount?: number; // test attendees, clamped 1–50, 0 = none
};

export type CreatedEvent = {
  eventId: string;
  name: string;
  accessMode: AccessMode;
  logoUrl: string | null;
  joinCode: string | null; // 'code' mode only — shown ONCE on the success screen
  codes: { email: string; code: string }[]; // 'roster' mode only
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function createEvent(
  input: CreateEventInput,
): Promise<{ error: string } | CreatedEvent> {
  const cleanName = input.name.trim();
  if (!cleanName) return { error: "Event name is required." };

  const startsAt = new Date(input.startsAtIso);
  if (isNaN(startsAt.getTime()))
    return { error: "Pick a valid start date & time." };

  const accessMode: AccessMode = ["open", "code", "roster"].includes(
    input.accessMode,
  )
    ? input.accessMode
    : "roster";
  const logoUrl = input.logoUrl?.trim() || null;

  // Roster: parse emails up front so a bad list never creates a half-event.
  let emails: string[] = [];
  if (accessMode === "roster") {
    emails = Array.from(
      new Set(
        (input.emails ?? "")
          .split(/[\n,;]+/)
          .map(normalizeEmail)
          .filter((e) => EMAIL_RE.test(e)),
      ),
    );
    if (emails.length === 0)
      return { error: "Add at least one valid attendee email." };
  }

  const joinCode =
    accessMode === "code"
      ? input.joinCode?.trim().toUpperCase() || newCode()
      : null;

  const eventId = makeEventId(cleanName);
  await sql`
    insert into events (id, name, starts_at, logo_url, access_mode, join_code)
    values (${eventId}, ${cleanName}, ${startsAt}, ${logoUrl}, ${accessMode}, ${joinCode})`;

  const codes = emails.map((email) => ({ email, code: newCode() }));
  if (codes.length > 0) {
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
  }

  const seedCount = input.seedCount ?? 0;
  if (seedCount > 0) await seedTestUsers(eventId, Math.min(50, seedCount));

  return { eventId, name: cleanName, accessMode, logoUrl, joinCode, codes };
}

// ---- Login (mode-aware gate; email is always the identity key) -------------

export async function login(
  eventId: string,
  emailRaw: string,
  codeRaw: string,
): Promise<{ error: string } | { ok: true; hasProfile: boolean }> {
  const email = normalizeEmail(emailRaw);
  const code = codeRaw.trim().toUpperCase();
  if (!EMAIL_RE.test(email)) return { error: "Enter a valid email address." };

  // join_code is read server-side ONLY — it must never reach a client.
  const eventRows = await sql`
    select access_mode, join_code from events where id = ${eventId} limit 1`;
  const event = eventRows[0];
  if (!event) return { error: "This event doesn't exist." };

  if (event.access_mode === "open") {
    // No gate — the email IS the identity.
  } else if (event.access_mode === "code") {
    if (!code) return { error: "Enter the event code." };
    if (code !== (event.join_code as string | null)?.toUpperCase())
      return { error: "That event code isn't right." };
  } else {
    // roster: the exact (event, email, code) triple, claimed once.
    if (!code) return { error: "Enter your email and code." };
    const rows = await sql`
      select id, claimed_at from access_codes
      where event_id = ${eventId} and email = ${email} and code = ${code}
      limit 1`;
    if (rows.length === 0)
      return { error: "That email and code don't match for this event." };
    if (!rows[0].claimed_at) {
      await sql`update access_codes set claimed_at = now() where id = ${rows[0].id}`;
    }
  }

  const existing = await sql`
    select id from profiles where event_id = ${eventId} and email = ${email} limit 1`;
  const profileId = existing[0]?.id as string | undefined;

  await setSession({ eventId, email, profileId });
  return { ok: true, hasProfile: !!profileId };
}

// ---- Save profile ----------------------------------------------------------

// Shaped for useActionState: returns { error } on validation failure,
// redirects on success (so the success "state" never renders). A raw
// progressive-enhancement POST invokes the action with FormData as the only
// argument, so tolerate both shapes.
export async function saveProfile(
  prev: { error: string } | null,
  formDataArg?: FormData,
): Promise<{ error: string } | null> {
  const formData =
    formDataArg ?? (prev instanceof FormData ? prev : new FormData());
  const session = await getSession();
  if (!session) redirect("/");

  const name = String(formData.get("name") ?? "").trim();
  const headline = String(formData.get("headline") ?? "").trim() || null;
  const solo = formData.get("solo") === "on";
  const tags = String(formData.get("tags") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8);

  // photos arrives as a JSON array from PhotoField; photo_url is derived, not
  // user-supplied — it's the denormalized cover every card/list reads.
  let photos: string[] = [];
  try {
    const parsed = JSON.parse(String(formData.get("photos") ?? "[]"));
    if (Array.isArray(parsed))
      photos = parsed
        .filter((p): p is string => typeof p === "string" && /^https?:\/\//.test(p))
        .slice(0, 6);
  } catch {
    // malformed payload -> no photos
  }
  const photo_url = photos[0] ?? null;

  const birthYearRaw = parseInt(String(formData.get("birth_year") ?? ""), 10);
  const nowYear = new Date().getFullYear();
  const birth_year =
    birthYearRaw >= 1900 && birthYearRaw <= nowYear - 10 ? birthYearRaw : null;

  const company = String(formData.get("company") ?? "").trim() || null;

  if (!name) return { error: "Name is required." };
  // At least one photo is an app invariant — the deck never deals photo-less
  // cards, so a profile can't exist without one.
  if (photos.length === 0) return { error: "Add at least one photo." };

  const isFirstProfile = !session.profileId;

  const rows = await sql`
    insert into profiles (id, event_id, email, name, headline, tags, photo_url, photos, solo, birth_year, company)
    values (${newId()}, ${session.eventId}, ${session.email}, ${name}, ${headline}, ${tags}, ${photo_url}, ${photos}, ${solo}, ${birth_year}, ${company})
    on conflict (event_id, email) do update
      set name = excluded.name,
          headline = excluded.headline,
          tags = excluded.tags,
          photo_url = excluded.photo_url,
          photos = excluded.photos,
          solo = excluded.solo,
          birth_year = excluded.birth_year,
          company = excluded.company
    returning id`;

  const profileId = rows[0].id as string;

  // First time this attendee sets up: seed pending requests from ~half the
  // test users so the Requests inbox has content immediately.
  if (isFirstProfile) await seedTestRequests(session.eventId, profileId);

  await setSession({ ...session, profileId });

  // Land where the app lands: Connect when it's live, Explore (countdown)
  // when it isn't.
  const liveRows = await sql`
    select starts_at <= now() as live from events where id = ${session.eventId} limit 1`;
  redirect(
    `/${session.eventId}/${liveRows[0]?.live ? "connect" : "explore"}`,
  );
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

// Background refill for the deck's prefetch queue. Filters ride along so
// pagination stays consistent with what the client is showing.
export async function fetchMoreCards(
  exclude: string[],
  filters?: DeckFilters,
): Promise<Card[]> {
  const session = await requireProfile();
  if (!session) return [];
  return getDeckCards(session.eventId, session.profileId, exclude, 12, filters);
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
