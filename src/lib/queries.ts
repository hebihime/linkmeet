import { sql } from "./db";
import type { AccessMode } from "./actions";
import { DEFAULT_FILTERS, type DeckFilters } from "./filters";

export type EventRow = {
  id: string;
  name: string;
  starts_at: Date;
  live: boolean; // starts_at <= now(), evaluated on the DB clock
  access_mode: AccessMode;
  logo_url: string | null;
  // NOTE: join_code is deliberately absent — EventRow flows to client
  // components (LoginForm) and the shared code must never leave the server.
};

export type Card = {
  id: string;
  name: string;
  headline: string | null;
  tags: string[];
  photo_url: string | null; // denormalized cover = photos[0]
  photos: string[]; // full gallery, shown in the profile view
};

export type Profile = Card & {
  solo: boolean;
  birth_date: string | null; // "YYYY-MM-DD"; null only on pre-gate rows
  company: string | null;
};

export async function getEvent(eventId: string) {
  const rows = await sql`
    select id, name, starts_at, starts_at <= now() as live,
           access_mode, logo_url
    from events where id = ${eventId} limit 1`;
  return rows[0] as EventRow | undefined;
}

export type EventListItem = {
  id: string;
  name: string;
  logo_url: string | null;
};

// The public finder carousel: every event, name + logo only. Listing is not
// access — each event still enforces its own gate at login.
export async function listEvents(): Promise<EventListItem[]> {
  const rows = await sql`
    select id, name, logo_url from events order by created_at desc`;
  return rows as unknown as EventListItem[];
}

export async function getProfile(profileId: string) {
  const rows = await sql`
    select id, name, headline, tags, photo_url, photos, solo,
           birth_date::text as birth_date, company
    from profiles where id = ${profileId} limit 1`;
  return rows[0] as Profile | undefined;
}

// Does this session's profile still exist in this event? Guards against stale
// session cookies whose profileId was deleted (e.g. a DB reset that reused the
// event id) — the JWT is still validly signed, but the row is gone.
export async function profileExistsInEvent(
  profileId: string,
  eventId: string,
): Promise<boolean> {
  const rows = await sql`
    select 1 from profiles
    where id = ${profileId} and event_id = ${eventId} limit 1`;
  return rows.length > 0;
}

// Deck candidates: never anyone you've already acted on (any intent, incl.
// pass), never an existing connection, never yourself, never ids in `exclude`
// (cards already in the client's hand). Ranked by shared-tag overlap (most
// interests in common first), with random() as the tiebreak so the deck stays
// fresh and people with no overlap still surface. No tags on your profile ->
// overlap is 0 for everyone -> pure random, same as before.
export async function getDeckCards(
  eventId: string,
  me: string,
  exclude: string[],
  limit = 12,
  filters?: DeckFilters,
): Promise<Card[]> {
  const f = { ...DEFAULT_FILTERS, ...filters };
  const hasAge = f.ageMin != null || f.ageMax != null;
  const companyQ = f.company.trim();
  const rows = await sql`
    select p.id, p.name, p.headline, p.tags, p.photo_url, p.photos
    from profiles p
    where p.event_id = ${eventId}
      and p.id <> ${me}
      and p.photo_url is not null
      and p.suspended_at is null
      and not (p.id = any(${exclude}))
      and not exists (
        select 1 from intents i
        where i.event_id = ${eventId} and i.from_id = ${me} and i.to_id = p.id
      )
      and not exists (
        select 1 from connections c
        where (c.profile_a = ${me} and c.profile_b = p.id)
           or (c.profile_b = ${me} and c.profile_a = p.id)
      )
      and (${f.tags.length === 0} or p.tags && ${f.tags})
      and (${!f.soloOnly} or p.solo)
      and (${!hasAge}
        or (p.birth_date is not null
            and p.birth_date <= current_date - make_interval(years => ${f.ageMin ?? 0})
            and p.birth_date >  current_date - make_interval(years => ${(f.ageMax ?? 149) + 1}))
        or (${f.ageUnspecified} and p.birth_date is null))
      and (${companyQ === ""}
        or (p.company is not null and p.company ilike ${"%" + companyQ + "%"})
        or (${f.companyUnspecified} and p.company is null))
    order by (
      select count(*)
      from unnest(p.tags) as t(tag)
      where t.tag = any(array(select unnest(tags) from profiles where id = ${me}))
    ) desc, random()
    limit ${limit}`;
  return rows as unknown as Card[];
}

// Tag options for the filters modal: every tag in use at this event, most
// common first, capped so the modal stays scannable.
export async function getEventTags(eventId: string): Promise<string[]> {
  const rows = await sql`
    select t.tag as tag, count(*)::int as n
    from profiles p, unnest(p.tags) as t(tag)
    where p.event_id = ${eventId}
    group by t.tag
    order by n desc, tag asc
    limit 30`;
  return rows.map((r) => r.tag as string);
}

export type ExploreStats = {
  total: number;
  tagCounts: { tag: string; count: number }[];
  soloCount: number;
};

export async function getExploreStats(
  eventId: string,
  me: Profile,
): Promise<ExploreStats> {
  const [totalRows, tagRows, soloRows] = await Promise.all([
    sql`select count(*)::int as n from profiles where event_id = ${eventId}`,
    me.tags.length > 0
      ? sql`
          select t.tag as tag, count(*)::int as count
          from profiles p, unnest(p.tags) as t(tag)
          where p.event_id = ${eventId} and p.id <> ${me.id}
            and t.tag = any(${me.tags})
          group by t.tag
          order by count desc`
      : Promise.resolve([]),
    me.solo
      ? sql`
          select count(*)::int as n from profiles
          where event_id = ${eventId} and id <> ${me.id} and solo = true`
      : Promise.resolve([{ n: 0 }]),
  ]);

  return {
    total: (totalRows[0]?.n as number) ?? 0,
    tagCounts: tagRows as unknown as { tag: string; count: number }[],
    soloCount: (soloRows[0]?.n as number) ?? 0,
  };
}

export type RequestItem = {
  id: string;
  kind: "meet" | "link" | "invite";
  created_at: Date;
  message: string | null; // invites carry an opening message; meet/link don't
  sender: Card;
};

export async function getRequests(
  eventId: string,
  me: string,
): Promise<RequestItem[]> {
  const rows = await sql`
    select i.id, i.kind, i.created_at, i.message,
           p.id as sender_id, p.name, p.headline, p.tags, p.photo_url, p.photos
    from intents i
    join profiles p on p.id = i.from_id
    where i.event_id = ${eventId} and i.to_id = ${me}
      and i.status = 'pending' and i.kind in ('meet','link','invite')
      and p.suspended_at is null
    order by i.created_at desc`;
  return rows.map((r) => ({
    id: r.id as string,
    kind: r.kind as "meet" | "link" | "invite",
    created_at: r.created_at as Date,
    message: (r.message as string | null) ?? null,
    sender: {
      id: r.sender_id as string,
      name: r.name as string,
      headline: (r.headline as string | null) ?? null,
      tags: (r.tags as string[]) ?? [],
      photo_url: (r.photo_url as string | null) ?? null,
      photos: (r.photos as string[]) ?? [],
    },
  }));
}

export async function getPendingRequestCount(eventId: string, me: string) {
  const rows = await sql`
    select count(*)::int as n from intents i
    join profiles p on p.id = i.from_id
    where i.event_id = ${eventId} and i.to_id = ${me}
      and i.status = 'pending' and i.kind in ('meet','link','invite')
      and p.suspended_at is null`;
  return (rows[0]?.n as number) ?? 0;
}

export type ConnectionListItem = {
  id: string;
  origin: string;
  met_confirmed_at: Date | null;
  other: { id: string; name: string; photo_url: string | null };
  last: { body: string; at: Date; mine: boolean } | null;
  unread: boolean; // other party has a message newer than my read cursor
};

// "Unread for me" as a SQL predicate: a message from the other party newer
// than my per-side read cursor (null cursor = never opened). Shared by the
// list query and the nav badge count so they can never disagree.
const unreadForMe = (me: string) => sql`
  exists (
    select 1 from messages um
    where um.connection_id = c.id
      and um.sender_id <> ${me}
      and (
        (c.profile_a = ${me} and (c.read_a is null or um.created_at > c.read_a)) or
        (c.profile_b = ${me} and (c.read_b is null or um.created_at > c.read_b))
      )
  )`;

export async function getConnections(
  eventId: string,
  me: string,
): Promise<ConnectionListItem[]> {
  const rows = await sql`
    select c.id, c.origin, c.met_confirmed_at,
           p.id as other_id, p.name as other_name, p.photo_url as other_photo,
           m.body as last_body, m.created_at as last_at, m.sender_id as last_sender,
           ${unreadForMe(me)} as unread
    from connections c
    join profiles p
      on p.id = case when c.profile_a = ${me} then c.profile_b else c.profile_a end
    left join lateral (
      select body, created_at, sender_id from messages
      where connection_id = c.id
      order by created_at desc limit 1
    ) m on true
    where c.event_id = ${eventId}
      and (c.profile_a = ${me} or c.profile_b = ${me})
    order by coalesce(m.created_at, c.created_at) desc`;
  return rows.map((r) => ({
    id: r.id as string,
    origin: r.origin as string,
    met_confirmed_at: (r.met_confirmed_at as Date | null) ?? null,
    other: {
      id: r.other_id as string,
      name: r.other_name as string,
      photo_url: (r.other_photo as string | null) ?? null,
    },
    last: r.last_body
      ? {
          body: r.last_body as string,
          at: r.last_at as Date,
          mine: r.last_sender === me,
        }
      : null,
    unread: r.unread as boolean,
  }));
}

export async function getUnreadChatCount(eventId: string, me: string) {
  const rows = await sql`
    select count(*)::int as n from connections c
    where c.event_id = ${eventId}
      and (c.profile_a = ${me} or c.profile_b = ${me})
      and ${unreadForMe(me)}`;
  return (rows[0]?.n as number) ?? 0;
}

export type ConnectionDetail = {
  id: string;
  event_id: string;
  origin: string;
  other: Card;
  iMet: boolean;
  theyMet: boolean;
  met_confirmed_at: Date | null;
  verified: boolean; // met_method = 'qr'
  rated: boolean; // I already submitted a rating for this connection
};

export async function getConnection(
  connectionId: string,
  me: string,
): Promise<ConnectionDetail | undefined> {
  const rows = await sql`
    select c.id, c.event_id, c.origin, c.profile_a, c.profile_b,
           c.met_a, c.met_b, c.met_confirmed_at, c.met_method,
           exists (
             select 1 from ratings r
             where r.connection_id = c.id and r.rater_id = ${me}
           ) as rated,
           p.id as other_id, p.name as other_name, p.headline as other_headline,
           p.tags as other_tags, p.photo_url as other_photo, p.photos as other_photos
    from connections c
    join profiles p
      on p.id = case when c.profile_a = ${me} then c.profile_b else c.profile_a end
    where c.id = ${connectionId}
      and (c.profile_a = ${me} or c.profile_b = ${me})
    limit 1`;
  const r = rows[0];
  if (!r) return undefined;
  const amA = r.profile_a === me;
  return {
    id: r.id as string,
    event_id: r.event_id as string,
    origin: r.origin as string,
    other: {
      id: r.other_id as string,
      name: r.other_name as string,
      headline: (r.other_headline as string | null) ?? null,
      tags: (r.other_tags as string[]) ?? [],
      photo_url: (r.other_photo as string | null) ?? null,
      photos: (r.other_photos as string[]) ?? [],
    },
    iMet: (amA ? r.met_a : r.met_b) as boolean,
    theyMet: (amA ? r.met_b : r.met_a) as boolean,
    met_confirmed_at: (r.met_confirmed_at as Date | null) ?? null,
    verified: r.met_method === "qr",
    rated: !!r.rated,
  };
}

export type Message = {
  id: string;
  sender_id: string;
  body: string;
  created_at: Date;
};

export async function getMessages(connectionId: string): Promise<Message[]> {
  const rows = await sql`
    select id, sender_id, body, created_at
    from messages
    where connection_id = ${connectionId}
    order by created_at asc`;
  return rows as unknown as Message[];
}
