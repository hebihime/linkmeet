import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { getMatches } from "@/lib/queries";

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default async function MatchesPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const session = await getSession();
  if (!session || session.eventId !== eventId) redirect(`/${eventId}`);
  if (!session.profileId) redirect(`/${eventId}/profile`);

  const matches = await getMatches(eventId, session.profileId);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-6 py-6">
      <header className="mb-6 flex items-center justify-between">
        <Link
          href={`/${eventId}/deck`}
          className="text-sm text-neutral-400 hover:text-white"
        >
          ← Deck
        </Link>
        <h1 className="text-lg font-bold">Matches</h1>
        <span className="w-10" />
      </header>

      {matches.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="text-neutral-400">
            No matches yet. When someone you want to meet wants to meet you too,
            they show up here.
          </p>
          <Link
            href={`/${eventId}/deck`}
            className="mt-2 rounded-full bg-white px-6 py-3 font-semibold text-black transition hover:bg-neutral-200"
          >
            Back to swiping
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {matches.map((m) => (
            <li
              key={m.id}
              className="flex items-center gap-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-4"
            >
              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-indigo-800 to-fuchsia-800 text-lg font-bold">
                {m.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={m.photo_url}
                    alt={m.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  initials(m.name)
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{m.name}</p>
                {m.headline && (
                  <p className="truncate text-sm text-neutral-400">
                    {m.headline}
                  </p>
                )}
              </div>
              <a
                href={`mailto:${m.email}`}
                className="shrink-0 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-neutral-200"
              >
                Say hi
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
