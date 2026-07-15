import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getNextCard } from "@/lib/queries";
import Deck from "./Deck";

export default async function DeckPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const session = await getSession();
  if (!session || session.eventId !== eventId) redirect(`/${eventId}`);
  if (!session.profileId) redirect(`/${eventId}/profile`);

  const initial = (await getNextCard(eventId, session.profileId)) ?? null;
  return <Deck eventId={eventId} initialCard={initial} />;
}
