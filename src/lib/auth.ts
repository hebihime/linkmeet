import { redirect } from "next/navigation";
import { getSession, type Session } from "./session";
import { profileExistsInEvent } from "./queries";

// Guard for /{eventId}/* pages: a session bound to this event, with a profile
// that STILL EXISTS. A validly-signed cookie whose profile row was deleted
// (e.g. a DB reset) must not pass — otherwise the holder browses profile-less.
export async function requireAttendee(
  eventId: string,
): Promise<Session & { profileId: string }> {
  const session = await getSession();
  if (!session || session.eventId !== eventId) redirect(`/${eventId}`);
  if (
    !session.profileId ||
    !(await profileExistsInEvent(session.profileId, eventId))
  )
    redirect(`/${eventId}/profile`);
  return session as Session & { profileId: string };
}

// Same, but profile optional (the profile page itself).
export async function requireSession(eventId: string): Promise<Session> {
  const session = await getSession();
  if (!session || session.eventId !== eventId) redirect(`/${eventId}`);
  return session;
}
