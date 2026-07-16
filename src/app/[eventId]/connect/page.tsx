import { redirect } from "next/navigation";
import { getEvent, getDeckCards } from "@/lib/queries";
import { requireAttendee } from "@/lib/auth";
import BottomNav from "../BottomNav";
import Deck from "./Deck";

export default async function ConnectPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const session = await requireAttendee(eventId);

  const event = await getEvent(eventId);
  if (!event) redirect("/");
  if (!event.live) redirect(`/${eventId}/explore`); // locked until the event starts

  const cards = await getDeckCards(eventId, session.profileId, [], 12);

  return (
    <>
      <Deck eventId={eventId} initialCards={cards} />
      <BottomNav eventId={eventId} active="connect" />
    </>
  );
}
