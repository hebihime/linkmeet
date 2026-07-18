import { redirect } from "next/navigation";
import { getConnection, getMessages } from "@/lib/queries";
import { requireAttendee } from "@/lib/auth";
import Thread from "./Thread";

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ eventId: string; connectionId: string }>;
}) {
  const { eventId, connectionId } = await params;
  const session = await requireAttendee(eventId);

  const conn = await getConnection(connectionId, session.profileId);
  if (!conn || conn.event_id !== eventId) redirect(`/${eventId}/chats`);

  const messages = await getMessages(connectionId);

  return (
    <Thread
      eventId={eventId}
      connectionId={connectionId}
      meId={session.profileId}
      other={conn.other}
      initialMessages={messages}
      initialMet={{
        iMet: conn.iMet,
        theyMet: conn.theyMet,
        confirmed: !!conn.met_confirmed_at,
        verified: conn.verified,
      }}
      initialRated={conn.rated}
    />
  );
}
