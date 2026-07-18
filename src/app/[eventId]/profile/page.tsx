import { getProfile } from "@/lib/queries";
import { requireSession } from "@/lib/auth";
import ProfileForm from "./ProfileForm";
import BottomNav from "../BottomNav";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const session = await requireSession(eventId);

  const existing = session.profileId
    ? await getProfile(session.profileId)
    : undefined;

  return (
    <>
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-5 px-6 py-10 pb-28">
        <h1 className="text-3xl font-bold tracking-tight">
          {existing ? "Edit your profile" : "Your profile"}
        </h1>
        <p className="text-sm text-neutral-400">
          This is what other attendees see on your card.
        </p>

        <ProfileForm existing={existing} />
      </main>
      {existing && <BottomNav eventId={eventId} active="profile" />}
    </>
  );
}
