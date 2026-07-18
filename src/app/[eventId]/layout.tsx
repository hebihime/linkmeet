import { getSession } from "@/lib/session";
import { getPendingRequestCount } from "@/lib/queries";
import BottomNav from "./BottomNav";

// The tab bar lives here so it persists across tab navigations instead of
// re-rendering (and re-querying) with every page. No nav until a profile
// exists — login and first-time setup keep the current chrome-less flow.
// BottomNav itself hides on non-tab routes (login, chat threads).
export default async function EventLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const session = await getSession();
  const profileId =
    session?.profileId && session.eventId === eventId
      ? session.profileId
      : null;
  const pending = profileId
    ? await getPendingRequestCount(eventId, profileId)
    : 0;

  return (
    <>
      {children}
      {profileId && <BottomNav eventId={eventId} pending={pending} />}
    </>
  );
}
