import { redirect } from "next/navigation";
import { getEvent } from "@/lib/queries";
import { getSession } from "@/lib/session";
import LoginForm from "./LoginForm";

export default async function EventEntry({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const event = await getEvent(eventId);

  if (!event) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-2xl font-bold">Event not found</h1>
        <p className="text-neutral-400">
          Double-check the link — this event doesn&apos;t exist.
        </p>
      </main>
    );
  }

  const session = await getSession();
  if (session?.eventId === eventId && session.profileId) {
    redirect(`/${eventId}/explore`);
  }

  return (
    <LoginForm
      eventId={eventId}
      eventName={event.name}
      accessMode={event.access_mode}
      logoUrl={event.logo_url}
    />
  );
}
