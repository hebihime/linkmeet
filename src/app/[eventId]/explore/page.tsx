import Link from "next/link";
import { redirect } from "next/navigation";
import { getEvent, getProfile, getExploreStats } from "@/lib/queries";
import { requireAttendee } from "@/lib/auth";
import BottomNav from "../BottomNav";
import Countdown from "./Countdown";

export default async function ExplorePage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const session = await requireAttendee(eventId);

  const [event, profile] = await Promise.all([
    getEvent(eventId),
    getProfile(session.profileId),
  ]);
  if (!event) redirect("/");
  if (!profile) redirect(`/${eventId}/profile`);

  const stats = await getExploreStats(eventId, profile);
  const live = event.live;

  return (
    <>
      <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-6 pb-28 pt-8">
        <header>
          <p className="text-sm uppercase tracking-widest text-neutral-500">
            LinkMeet
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">
            {event.name}
          </h1>
        </header>

        <section className="rounded-3xl border border-neutral-800 bg-gradient-to-br from-indigo-950/60 via-neutral-900 to-fuchsia-950/60 p-6">
          <p className="text-5xl font-bold tracking-tight">
            {stats.total.toLocaleString()}
          </p>
          <p className="mt-1 text-neutral-400">
            attendee{stats.total === 1 ? "" : "s"} joined {event.name}
          </p>
        </section>

        {live ? (
          <Link
            href={`/${eventId}/connect`}
            className="flex items-center justify-between rounded-3xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-6 py-5 font-semibold text-white shadow-lg shadow-fuchsia-950/40 transition hover:brightness-110"
          >
            <span>Connect is live</span>
            <span className="text-xl">→</span>
          </Link>
        ) : (
          <section className="rounded-3xl border border-neutral-800 bg-neutral-900 p-6">
            <p className="text-sm text-neutral-400">Connect opens in</p>
            <Countdown target={new Date(event.starts_at).toISOString()} />
            <p className="mt-2 text-sm text-neutral-500">
              Until then, watch who&apos;s arriving — no browsing, no
              front-running, everyone starts together.
            </p>
          </section>
        )}

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-neutral-500">
            People like you here
          </h2>

          {stats.tagCounts.length > 0 ? (
            stats.tagCounts.map((t) => (
              <div
                key={t.tag}
                className="flex items-center justify-between rounded-2xl border border-neutral-800 bg-neutral-900 px-5 py-4"
              >
                <span className="text-neutral-300">
                  share your interest in{" "}
                  <span className="font-semibold text-white">{t.tag}</span>
                </span>
                <span className="text-2xl font-bold text-fuchsia-400">
                  {t.count}
                </span>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-neutral-800 px-5 py-4 text-sm text-neutral-500">
              Add interest tags to your{" "}
              <Link href={`/${eventId}/profile`} className="underline">
                profile
              </Link>{" "}
              to see who shares them.
            </div>
          )}

          {profile.solo && (
            <div className="flex items-center justify-between rounded-2xl border border-neutral-800 bg-neutral-900 px-5 py-4">
              <span className="text-neutral-300">
                also here <span className="font-semibold text-white">solo</span>
              </span>
              <span className="text-2xl font-bold text-indigo-400">
                {stats.soloCount}
              </span>
            </div>
          )}
        </section>
      </main>
      <BottomNav eventId={eventId} active="explore" />
    </>
  );
}
