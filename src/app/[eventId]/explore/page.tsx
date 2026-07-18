import Link from "next/link";
import { redirect } from "next/navigation";
import { getEvent, getProfile, getExploreStats } from "@/lib/queries";
import { requireAttendee } from "@/lib/auth";
import Countdown from "./Countdown";

// "AI Con 2026" -> "AC" — placeholder mark when the event has no logo.
function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

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

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col pb-28">
        {/* Hero — same pattern as the login screen: event image with the
            wordmark + title anchored to the bottom. */}
        <div className="relative h-64 w-full shrink-0 overflow-hidden">
          {event.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={event.logo_url}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-7xl font-bold text-white/90">
              {initials(event.name)}
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 px-6 py-5">
            <p className="text-sm uppercase tracking-widest text-neutral-300">
              LinkMeet
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-white drop-shadow">
              {event.name}
            </h1>
          </div>
        </div>

        <div className="flex flex-col gap-8 px-6 pt-6">
          {!event.live && (
            <section>
              <p className="text-sm text-neutral-400">Connect opens in</p>
              <Countdown target={new Date(event.starts_at).toISOString()} />
              <p className="mt-2 text-sm text-neutral-500">
                Until then, watch who&apos;s arriving — no browsing, no
                front-running, everyone starts together.
              </p>
            </section>
          )}

          <section>
            <p className="text-5xl font-bold tracking-tight">
              {stats.total.toLocaleString()}
            </p>
            <p className="mt-1 text-neutral-400">
              attendee{stats.total === 1 ? "" : "s"} joined {event.name}
            </p>
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-neutral-500">
              People like you here
            </h2>

            {stats.tagCounts.length > 0 ? (
              stats.tagCounts.map((t) => (
                <div key={t.tag} className="flex items-baseline justify-between">
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
              <p className="text-sm text-neutral-500">
                Add interest tags to your{" "}
                <Link href={`/${eventId}/profile`} className="underline">
                  profile
                </Link>{" "}
                to see who shares them.
              </p>
            )}

            {profile.solo && (
              <div className="flex items-baseline justify-between">
                <span className="text-neutral-300">
                  also here <span className="font-semibold text-white">solo</span>
                </span>
                <span className="text-2xl font-bold text-indigo-400">
                  {stats.soloCount}
                </span>
              </div>
            )}
          </section>
        </div>
    </main>
  );
}
