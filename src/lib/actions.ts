"use server";

import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { sql } from "./db";
import { getSession, setSession, type Session } from "./session";
import { makeEventId, newId, newCode, normalizeEmail } from "./ids";
import {
  getDeckCards,
  getMessages,
  profileExistsInEvent,
  type Card,
  type Message,
} from "./queries";
import type { DeckFilters } from "./filters";
import { seedTestUsers, seedTestRequests, testUserReply } from "./seed";
import { checkProfileText, containsUnsafe } from "./moderation";
import { POSITIVE_KEYS, REPORT_KEYS } from "./feedback";

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

// Exact age from a "YYYY-MM-DD" string, or null if it isn't a real date.
// Full DOB (not year) on purpose: a self-reported year lets a late-birthday
// 17-year-old through; a date makes the 18 boundary exact.
function ageFromDob(dob: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const birth = new Date(Date.UTC(y, mo - 1, d));
  if (
    birth.getUTCFullYear() !== y ||
    birth.getUTCMonth() !== mo - 1 ||
    birth.getUTCDate() !== d
  )
    return null;
  const now = new Date();
  let age = now.getUTCFullYear() - y;
  if (
    now.getUTCMonth() + 1 < mo ||
    (now.getUTCMonth() + 1 === mo && now.getUTCDate() < d)
  )
    age--;
  return age;
}

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

  const company = String(formData.get("company") ?? "").trim() || null;

  if (!name) return { error: "Name is required." };
  // At least one photo is an app invariant — the deck never deals photo-less
  // cards, so a profile can't exist without one.
  if (photos.length === 0) return { error: "Add at least one photo." };

  // 18+ gate. LinkMeet is adults-only: exact DOB (required) plus an explicit
  // attestation checkbox — the attestation is the legal backstop for a
  // self-reported date. birth_year is dormant; birth_date is the source of
  // truth for all age reads.
  const birth_date = String(formData.get("birth_date") ?? "").trim();
  const age = ageFromDob(birth_date);
  if (age === null) return { error: "Enter your date of birth." };
  if (age < 18) return { error: "You must be 18 or older to use LinkMeet." };
  if (age > 120) return { error: "Enter your real date of birth." };
  if (formData.get("adult") !== "on")
    return { error: "Confirm that you're 18 or older." };

  // Safety filter on every card-visible text field. Reject with a message
  // rather than silently stripping, so nothing appears to save when it didn't.
  const unsafe = checkProfileText({ name, headline, company, tags });
  if (unsafe)
    return {
      error:
        unsafe.field === "tags"
          ? `That tag isn't allowed — remove "${unsafe.term}" and try again.`
          : `Your ${unsafe.field} contains a word that isn't allowed ("${unsafe.term}").`,
    };

  const isFirstProfile = !session.profileId;

  const rows = await sql`
    insert into profiles (id, event_id, email, name, headline, tags, photo_url, photos, solo, birth_date, company)
    values (${newId()}, ${session.eventId}, ${session.email}, ${name}, ${headline}, ${tags}, ${photo_url}, ${photos}, ${solo}, ${birth_date}, ${company})
    on conflict (event_id, email) do update
      set name = excluded.name,
          headline = excluded.headline,
          tags = excluded.tags,
          photo_url = excluded.photo_url,
          photos = excluded.photos,
          solo = excluded.solo,
          birth_date = excluded.birth_date,
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
  // Stale cookie whose profile was deleted (e.g. a DB reset): treat as no
  // profile so actions no-op instead of writing against a dangling FK.
  if (!(await profileExistsInEvent(session.profileId, session.eventId)))
    return null;
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

// An invite's opening message (and optional photo) becomes the first message(s)
// in the thread. Seeded on send for a test target, or on accept for a real one.
async function seedInviteMessages(
  connectionId: string,
  senderId: string,
  message: string,
  photoUrl: string | null,
) {
  await sql`
    insert into messages (id, connection_id, sender_id, body)
    values (${newId()}, ${connectionId}, ${senderId}, ${message})`;
  if (photoUrl) {
    await sql`
      insert into messages (id, connection_id, sender_id, body)
      values (${newId()}, ${connectionId}, ${senderId}, ${photoUrl})`;
  }
}

/**
 * Moderate a free-text message body (invite openers, and later chat). Returns
 * the offending term, or null when clean. Same engine as profile fields; the
 * single seam an LLM pass can later slot behind. Cheap + deterministic today.
 */
export async function moderateMessage(
  text: string,
): Promise<{ term: string } | null> {
  const term = containsUnsafe(text.trim());
  return term ? { term } : null;
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
    // Server-side backstop: the composer validates before it lets the card fly
    // off, but never trust the client — an unsafe invite body never persists.
    if (containsUnsafe(message)) return none;
    const photoUrl = (input.photoUrl ?? "").trim() || null;
    // Invites are consent-gated like meet/link: they land in the recipient's
    // requests inbox (carrying this message) and only open a thread once
    // accepted. Test targets still auto-accept so the loop stays solo-testable.
    const autoAccept = target.is_test as boolean;

    const inserted = await sql`
      insert into intents (id, event_id, from_id, to_id, kind, message, photo_url, status, responded_at)
      values (${newId()}, ${session.eventId}, ${me}, ${targetId}, 'invite', ${message}, ${photoUrl},
              ${autoAccept ? "accepted" : "pending"}, ${autoAccept ? new Date() : null})
      on conflict (event_id, from_id, to_id) do nothing
      returning id`;
    if (!inserted[0]) return none; // already acted on this person
    if (!autoAccept) return none; // pending request; receiver decides

    const connectionId = await ensureConnection(
      session.eventId,
      me,
      targetId,
      "invite",
    );
    await seedInviteMessages(connectionId, me, message, photoUrl);
    await testUserReply(connectionId, targetId);
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
      and kind in ('meet','link','invite')
    returning from_id, kind, event_id, message, photo_url`;
  const intent = rows[0];
  if (!intent || !accept) return { connectionId: null }; // declines are silent

  const connectionId = await ensureConnection(
    intent.event_id as string,
    me,
    intent.from_id as string,
    intent.kind as string,
  );

  // Accepting an invite opens the thread with the inviter's original message.
  if (intent.kind === "invite" && intent.message) {
    await seedInviteMessages(
      connectionId,
      intent.from_id as string,
      intent.message as string,
      (intent.photo_url as string | null) ?? null,
    );
  }

  const sender = await sql`
    select is_test from profiles where id = ${intent.from_id} limit 1`;
  if (sender[0]?.is_test)
    await testUserReply(connectionId, intent.from_id as string);

  return { connectionId };
}

// ---- Chat --------------------------------------------------------------------

async function myConnection(connectionId: string, me: string) {
  const rows = await sql`
    select id, event_id, profile_a, profile_b, met_a, met_b, met_confirmed_at,
           met_method
    from connections
    where id = ${connectionId} and (profile_a = ${me} or profile_b = ${me})
    limit 1`;
  return rows[0];
}

export type MetState = {
  iMet: boolean;
  theyMet: boolean;
  confirmed: boolean;
  verified: boolean; // met_method = 'qr' — the only weight-bearing state
};

export type ThreadState = {
  messages: Message[];
  met: MetState;
  rated: boolean; // I already rated this connection
};

function metStateFor(
  me: string,
  conn: {
    profile_a: string;
    met_a: boolean;
    met_b: boolean;
    met_confirmed_at: Date | null;
    met_method: string | null;
  },
): MetState {
  const amA = conn.profile_a === me;
  return {
    iMet: amA ? conn.met_a : conn.met_b,
    theyMet: amA ? conn.met_b : conn.met_a,
    confirmed: !!conn.met_confirmed_at,
    verified: conn.met_method === "qr",
  };
}

export async function fetchThread(
  connectionId: string,
): Promise<ThreadState | null> {
  const session = await requireProfile();
  if (!session) return null;
  const conn = await myConnection(connectionId, session.profileId);
  if (!conn) return null;

  // Opening or polling the thread marks it read for me — clears the unread dot
  // and nav badge on the next tab render. Cursor is per-side (a/b).
  if (conn.profile_a === session.profileId) {
    await sql`update connections set read_a = now() where id = ${connectionId}`;
  } else {
    await sql`update connections set read_b = now() where id = ${connectionId}`;
  }

  const [messages, myRating] = await Promise.all([
    getMessages(connectionId),
    sql`select 1 from ratings
        where connection_id = ${connectionId} and rater_id = ${session.profileId}
        limit 1`,
  ]);
  return {
    messages,
    met: metStateFor(session.profileId, conn as never),
    rated: myRating.length > 0,
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

// Soft "we met" — the legacy honor tap. Each side taps once; both taps =
// confirmed; test users tap back immediately. Purely cosmetic now: it never
// sets met_method, so it unlocks nothing (ratings and reputation require the
// QR-verified path below).
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
    returning profile_a, profile_b, met_a, met_b, met_confirmed_at, met_method`;
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
    verified: updated.met_method === "qr",
  };
}

// ---- Verified "we met": QR bump + GPS confidence signal ---------------------
//
// One side shows a signed short-lived QR token; the other scans it. A scan
// proves physical presence well enough to close the *unilateral* fake (you
// can't scan a code that isn't in front of your lens). Two willing colluders
// remain possible — that residual hole is discounted later by reputation
// graph/velocity checks, not prevented here.
//
// GPS is a confidence/fraud signal, NOT proof: web geolocation is spoofable
// in seconds (devtools sensors, extensions) and drifts 20–100m+ indoors. So
// distance discounts met_confidence and flags impossible pairs, but never
// hard-rejects a scan — a real meet inside a concrete venue must not bounce.

export type MeetCoords = { lat: number; lng: number };

const MEET_TOKEN_TTL_S = 120;

function meetSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return new TextEncoder().encode(s);
}

function haversineMeters(a: MeetCoords, b: MeetCoords): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function cleanCoords(c: unknown): MeetCoords | null {
  if (!c || typeof c !== "object") return null;
  const { lat, lng } = c as MeetCoords;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!isFinite(lat) || !isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

// Writes the verified state: both met flags, met_method='qr', coords in the
// right a/b slots, distance + confidence. Idempotent — an already-verified
// connection is left untouched so a replay can't overwrite recorded coords.
async function applyQrConfirm(
  connectionId: string,
  conn: { profile_a: string; profile_b: string; met_method: string | null },
  issuerId: string,
  issuerCoords: MeetCoords | null,
  scannerCoords: MeetCoords | null,
): Promise<void> {
  if (conn.met_method === "qr") return;

  const issuerIsA = conn.profile_a === issuerId;
  const aCoords = issuerIsA ? issuerCoords : scannerCoords;
  const bCoords = issuerIsA ? scannerCoords : issuerCoords;

  const distance =
    aCoords && bCoords ? haversineMeters(aCoords, bCoords) : null;
  // Confidence: 70 = QR alone (either side lacked GPS). Consistent GPS raises
  // it; inconsistent GPS lowers it; different-cities distance = fraud-flag
  // territory but still records (never hard-reject on GPS alone).
  const confidence =
    distance === null
      ? 70
      : distance <= 250
        ? 95
        : distance <= 1500
          ? 85
          : distance <= 50000
            ? 40
            : 10;

  await sql`
    update connections set
      met_a = true,
      met_b = true,
      met_confirmed_at = coalesce(met_confirmed_at, now()),
      met_method = 'qr',
      met_lat_a = ${aCoords?.lat ?? null},
      met_lng_a = ${aCoords?.lng ?? null},
      met_lat_b = ${bCoords?.lat ?? null},
      met_lng_b = ${bCoords?.lng ?? null},
      met_distance_m = ${distance},
      met_confidence = ${confidence}
    where id = ${connectionId} and met_method is distinct from 'qr'`;
}

export type MintMeetResult =
  | { error: string }
  | { token: string; ttlSeconds: number; autoConfirmed: MetState | null };

// "Show my code": mint a signed token bound to (connection, me). The
// counterparty's scan — not this mint — is what confirms. Issuer coords ride
// inside the signed token so the confirm step has both sides' GPS without an
// extra round trip. If the counterparty is a test user there is no second
// device, so the scan is simulated immediately (the solo-testable bypass).
export async function mintMeetToken(
  connectionId: string,
  coords: MeetCoords | null,
): Promise<MintMeetResult> {
  const session = await requireProfile();
  if (!session) return { error: "Not signed in." };
  const me = session.profileId;
  const conn = await myConnection(connectionId, me);
  if (!conn) return { error: "Connection not found." };

  const safeCoords = cleanCoords(coords);
  const token = await new SignJWT({
    p: "meet",
    cid: connectionId,
    iss_id: me,
    lat: safeCoords?.lat,
    lng: safeCoords?.lng,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MEET_TOKEN_TTL_S}s`)
    .sign(meetSecret());

  const otherId = (conn.profile_a === me ? conn.profile_b : conn.profile_a) as string;
  const other = await sql`
    select is_test from profiles where id = ${otherId} limit 1`;

  let autoConfirmed: MetState | null = null;
  if (other[0]?.is_test) {
    await applyQrConfirm(connectionId, conn as never, me, safeCoords, safeCoords);
    const updated = await myConnection(connectionId, me);
    autoConfirmed = metStateFor(me, updated as never);
  }

  return { token, ttlSeconds: MEET_TOKEN_TTL_S, autoConfirmed };
}

// "Scan to confirm": the counterparty posts the token they scanned. Signature
// + freshness (exp) + binding checks: the token's connection must be one I'm
// in, and its issuer must be the *other* member — I can't scan my own code.
// One valid scan confirms the pair atomically.
export async function confirmMeetScan(
  token: string,
  coords: MeetCoords | null,
): Promise<{ met: MetState } | { error: string }> {
  const session = await requireProfile();
  if (!session) return { error: "Not signed in." };
  const me = session.profileId;

  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, meetSecret()));
  } catch {
    return { error: "That code expired — ask them to show a fresh one." };
  }
  if (payload.p !== "meet" || typeof payload.cid !== "string")
    return { error: "That's not a LinkMeet code." };

  const conn = await myConnection(payload.cid, me);
  if (!conn) return { error: "That code is for a different connection." };
  const issuerId = payload.iss_id as string;
  if (issuerId === me) return { error: "That's your own code — they scan yours, or you scan theirs." };
  if (issuerId !== conn.profile_a && issuerId !== conn.profile_b)
    return { error: "That code is for a different connection." };

  const issuerCoords = cleanCoords({
    lat: payload.lat as number,
    lng: payload.lng as number,
  });
  await applyQrConfirm(
    payload.cid,
    conn as never,
    issuerId,
    issuerCoords,
    cleanCoords(coords),
  );
  const updated = await myConnection(payload.cid, me);
  return { met: metStateFor(me, updated as never) };
}

// ---- Ratings + safety reports ----------------------------------------------
//
// Two channels, never one star scale. Ratings (positive endorsement) unlock
// ONLY on a QR-verified meet; they're private/aggregate and double-blind.
// Safety reports need no verified meet — someone harassing you in chat never
// met you — and are routed to review with an automated threshold backstop.

export async function submitRating(
  connectionId: string,
  endorse: boolean,
  positives: string[],
): Promise<{ ok: true } | { error: string }> {
  const session = await requireProfile();
  if (!session) return { error: "Not signed in." };
  const me = session.profileId;
  const conn = await myConnection(connectionId, me);
  if (!conn) return { error: "Connection not found." };
  if (conn.met_method !== "qr")
    return { error: "Ratings unlock after you verify you met in person." };

  const clean = positives.filter((p) => POSITIVE_KEYS.includes(p)).slice(0, 8);
  const rateeId = (conn.profile_a === me ? conn.profile_b : conn.profile_a) as string;
  await sql`
    insert into ratings (id, connection_id, rater_id, ratee_id, endorse, positives)
    values (${newId()}, ${connectionId}, ${me}, ${rateeId}, ${endorse}, ${clean})
    on conflict (connection_id, rater_id) do nothing`;
  return { ok: true };
}

// N distinct reporters (excluding no-shows) auto-suspends pending review —
// the interim trust-safety response while there's no moderation surface.
const SUSPEND_REPORTER_THRESHOLD = 3;

export async function submitSafetyReport(
  connectionId: string,
  reason: string,
  detail: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await requireProfile();
  if (!session) return { error: "Not signed in." };
  const me = session.profileId;
  const conn = await myConnection(connectionId, me);
  if (!conn) return { error: "Connection not found." };
  if (!REPORT_KEYS.includes(reason))
    return { error: "Pick what happened." };

  const reportedId = (conn.profile_a === me ? conn.profile_b : conn.profile_a) as string;
  const cleanDetail = detail.trim().slice(0, 1000) || null;

  // One report per reporter per connection — resubmits are a quiet no-op.
  const existing = await sql`
    select 1 from safety_reports
    where connection_id = ${connectionId} and reporter_id = ${me} limit 1`;
  if (existing.length === 0) {
    await sql`
      insert into safety_reports (id, connection_id, reporter_id, reported_id, reason, detail)
      values (${newId()}, ${connectionId}, ${me}, ${reportedId}, ${reason}, ${cleanDetail})`;
    await sql`
      update profiles set suspended_at = now()
      where id = ${reportedId} and suspended_at is null
        and (select count(distinct reporter_id) from safety_reports
             where reported_id = ${reportedId} and reason <> 'no_show')
            >= ${SUSPEND_REPORTER_THRESHOLD}`;
  }

  // Reporting also blocks: drop the pair from each other's decks with a
  // bidirectional 'pass' (so neither resurfaces or can re-invite the other),
  // then delete the conversation. The connection FK sets the report's
  // connection_id null on delete, so the report itself survives for review.
  const eventId = conn.event_id as string;
  await sql`
    insert into intents (id, event_id, from_id, to_id, kind, status, responded_at)
    values
      (${newId()}, ${eventId}, ${me}, ${reportedId}, 'pass', 'none', now()),
      (${newId()}, ${eventId}, ${reportedId}, ${me}, 'pass', 'none', now())
    on conflict (event_id, from_id, to_id)
      do update set kind = 'pass', status = 'none', responded_at = now()`;
  await sql`delete from connections where id = ${connectionId}`;
  return { ok: true };
}
