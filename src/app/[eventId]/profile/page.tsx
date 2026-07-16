import { getProfile } from "@/lib/queries";
import { saveProfile } from "@/lib/actions";
import { requireSession } from "@/lib/auth";
import PhotoField from "./PhotoField";
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
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-6 py-10 pb-28">
        <h1 className="text-3xl font-bold tracking-tight">
          {existing ? "Edit your profile" : "Your profile"}
        </h1>
        <p className="text-sm text-neutral-400">
          This is what other attendees see on your card.
        </p>

        <form action={saveProfile} className="flex flex-col gap-5">
          <label className="flex flex-col gap-2 text-sm">
            <span className="text-neutral-300">Name</span>
            <input
              name="name"
              required
              defaultValue={existing?.name ?? ""}
              placeholder="Ada Lovelace"
              className="rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 outline-none focus:border-neutral-400"
            />
          </label>

          <label className="flex flex-col gap-2 text-sm">
            <span className="text-neutral-300">
              Headline <span className="text-neutral-500">(optional)</span>
            </span>
            <input
              name="headline"
              defaultValue={existing?.headline ?? ""}
              placeholder="Founder · here to meet other builders"
              className="rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 outline-none focus:border-neutral-400"
            />
          </label>

          <label className="flex flex-col gap-2 text-sm">
            <span className="text-neutral-300">
              Interest tags{" "}
              <span className="text-neutral-500">(comma-separated, up to 8)</span>
            </span>
            <input
              name="tags"
              defaultValue={existing?.tags?.join(", ") ?? ""}
              placeholder="AI, climbing, jazz, medtech"
              className="rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 outline-none focus:border-neutral-400"
            />
          </label>

          <PhotoField defaultUrl={existing?.photo_url} />

          <label className="flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-3 text-sm">
            <input
              type="checkbox"
              name="solo"
              defaultChecked={existing?.solo ?? false}
              className="h-4 w-4 accent-fuchsia-500"
            />
            <span className="text-neutral-300">
              I&apos;m attending solo
              <span className="block text-xs text-neutral-500">
                Helps you find others who came alone too.
              </span>
            </span>
          </label>

          <button
            type="submit"
            className="rounded-full bg-white px-6 py-3 font-semibold text-black transition hover:bg-neutral-200"
          >
            {existing ? "Save" : "Continue"}
          </button>
        </form>
      </main>
      {existing && <BottomNav eventId={eventId} active="profile" />}
    </>
  );
}
