import { redirect } from "next/navigation";
import { getSession, type Session } from "./session";

// Guard for /{eventId}/* pages: a session bound to this event, with a profile.
export async function requireAttendee(
  eventId: string,
): Promise<Session & { profileId: string }> {
  const session = await getSession();
  if (!session || session.eventId !== eventId) redirect(`/${eventId}`);
  if (!session.profileId) redirect(`/${eventId}/profile`);
  return session as Session & { profileId: string };
}

// Same, but profile optional (the profile page itself).
export async function requireSession(eventId: string): Promise<Session> {
  const session = await getSession();
  if (!session || session.eventId !== eventId) redirect(`/${eventId}`);
  return session;
}
