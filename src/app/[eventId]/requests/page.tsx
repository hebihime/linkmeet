import { getRequests } from "@/lib/queries";
import { requireAttendee } from "@/lib/auth";
import BottomNav from "../BottomNav";
import RequestList from "./RequestList";

export default async function RequestsPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const session = await requireAttendee(eventId);
  const requests = await getRequests(eventId, session.profileId);

  return (
    <>
      <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 px-6 pb-28 pt-8">
        <header>
          <h1 className="text-3xl font-bold tracking-tight">Requests</h1>
          <p className="mt-1 text-sm text-neutral-400">
            People who want to connect with you. Declining is silent — they
            never find out.
          </p>
        </header>
        <RequestList eventId={eventId} initial={requests} />
      </main>
      <BottomNav eventId={eventId} active="requests" />
    </>
  );
}
