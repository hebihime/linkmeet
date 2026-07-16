import { sql } from "./db";

export type EventRow = {
  id: string;
  name: string;
  starts_at: Date;
  live: boolean; // starts_at <= now(), evaluated on the DB clock
};

export type Card = {
  id: string;
  name: string;
  headline: string | null;
  tags: string[];
  photo_url: string | null;
};

export type Profile = Card & { solo: boolean };

export async function getEvent(eventId: string) {
  const rows = await sql`
    select id, name, starts_at, starts_at <= now() as live
    from events where id = ${eventId} limit 1`;
  return rows[0] as EventRow | undefined;
}

export async function getProfile(profileId: string) {
  const rows = await sql`
    select id, name, headline, tags, photo_url, solo
    from profiles where id = ${profileId} limit 1`;
  return rows[0] as Profile | undefined;
}

// Deck candidates: never anyone you've already acted on (any intent, incl.
// pass), never an existing connection, never yourself, never ids in `exclude`
// (cards already in the client's hand).
export async function getDeckCards(
  eventId: string,
  me: string,
  exclude: string[],
  limit = 12,
): Promise<Card[]> {
  const rows = await sql`
    select p.id, p.name, p.headline, p.tags, p.photo_url
    from profiles p
    where p.event_id = ${eventId}
      and p.id <> ${me}
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
    order by random()
    limit ${limit}`;
  return rows as unknown as Card[];
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
  kind: "meet" | "link";
  created_at: Date;
  sender: Card;
};

export async function getRequests(
  eventId: string,
  me: string,
): Promise<RequestItem[]> {
  const rows = await sql`
    select i.id, i.kind, i.created_at,
           p.id as sender_id, p.name, p.headline, p.tags, p.photo_url
    from intents i
    join profiles p on p.id = i.from_id
    where i.event_id = ${eventId} and i.to_id = ${me}
      and i.status = 'pending' and i.kind in ('meet','link')
    order by i.created_at desc`;
  return rows.map((r) => ({
    id: r.id as string,
    kind: r.kind as "meet" | "link",
    created_at: r.created_at as Date,
    sender: {
      id: r.sender_id as string,
      name: r.name as string,
      headline: (r.headline as string | null) ?? null,
      tags: (r.tags as string[]) ?? [],
      photo_url: (r.photo_url as string | null) ?? null,
    },
  }));
}

export async function getPendingRequestCount(eventId: string, me: string) {
  const rows = await sql`
    select count(*)::int as n from intents
    where event_id = ${eventId} and to_id = ${me}
      and status = 'pending' and kind in ('meet','link')`;
  return (rows[0]?.n as number) ?? 0;
}

export type ConnectionListItem = {
  id: string;
  origin: string;
  met_confirmed_at: Date | null;
  other: { id: string; name: string; photo_url: string | null };
  last: { body: string; at: Date; mine: boolean } | null;
};

export async function getConnections(
  eventId: string,
  me: string,
): Promise<ConnectionListItem[]> {
  const rows = await sql`
    select c.id, c.origin, c.met_confirmed_at,
           p.id as other_id, p.name as other_name, p.photo_url as other_photo,
           m.body as last_body, m.created_at as last_at, m.sender_id as last_sender
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
  }));
}

export type ConnectionDetail = {
  id: string;
  event_id: string;
  origin: string;
  other: Card;
  iMet: boolean;
  theyMet: boolean;
  met_confirmed_at: Date | null;
};

export async function getConnection(
  connectionId: string,
  me: string,
): Promise<ConnectionDetail | undefined> {
  const rows = await sql`
    select c.id, c.event_id, c.origin, c.profile_a, c.profile_b,
           c.met_a, c.met_b, c.met_confirmed_at,
           p.id as other_id, p.name as other_name, p.headline as other_headline,
           p.tags as other_tags, p.photo_url as other_photo
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
    },
    iMet: (amA ? r.met_a : r.met_b) as boolean,
    theyMet: (amA ? r.met_b : r.met_a) as boolean,
    met_confirmed_at: (r.met_confirmed_at as Date | null) ?? null,
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
