import { sql } from "./db";

export type Card = {
  id: string;
  name: string;
  headline: string | null;
  tags: string[];
  photo_url: string | null;
};

export async function getEvent(eventId: string) {
  const rows = await sql`select id, name from events where id = ${eventId} limit 1`;
  return rows[0] as { id: string; name: string } | undefined;
}

export async function getProfile(profileId: string) {
  const rows = await sql`
    select id, name, headline, tags, photo_url
    from profiles where id = ${profileId} limit 1`;
  return rows[0] as Card | undefined;
}

// Next un-swiped attendee in this event.
export async function getNextCard(
  eventId: string,
  me: string,
): Promise<Card | undefined> {
  const rows = await sql`
    select id, name, headline, tags, photo_url from profiles p
    where p.event_id = ${eventId}
      and p.id <> ${me}
      and not exists (
        select 1 from swipes s
        where s.swiper_id = ${me} and s.target_id = p.id
      )
    order by random()
    limit 1`;
  return rows[0] as Card | undefined;
}

export type Match = Card & { email: string };

export async function getMatches(
  eventId: string,
  me: string,
): Promise<Match[]> {
  const rows = await sql`
    select p.id, p.name, p.headline, p.tags, p.photo_url, p.email
    from matches m
    join profiles p on p.id = case when m.profile_a = ${me} then m.profile_b else m.profile_a end
    where m.event_id = ${eventId} and (m.profile_a = ${me} or m.profile_b = ${me})
    order by m.created_at desc`;
  return rows as unknown as Match[];
}
