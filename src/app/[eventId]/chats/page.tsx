import Link from "next/link";
import { getConnections } from "@/lib/queries";
import { requireAttendee } from "@/lib/auth";

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default async function ChatsPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const session = await requireAttendee(eventId);
  const connections = await getConnections(eventId, session.profileId);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-6 pb-28 pt-8">
        <header>
          <h1 className="text-3xl font-bold tracking-tight">Chats</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Your connections at this event.
          </p>
        </header>

        {connections.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-neutral-800 px-8 py-16 text-center">
            <h2 className="text-xl font-bold">No connections yet</h2>
            <p className="text-sm text-neutral-400">
              Send a Meet or Link on the deck — when it&apos;s accepted, the
              chat opens here.
            </p>
            <Link
              href={`/${eventId}/connect`}
              className="mt-2 rounded-full bg-white px-6 py-3 font-semibold text-black transition hover:bg-neutral-200"
            >
              Start connecting
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {connections.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/${eventId}/chats/${c.id}`}
                  className="flex items-center gap-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-4 transition hover:border-neutral-600"
                >
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-indigo-800 to-fuchsia-800">
                    {c.other.photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.other.photo_url}
                        alt={c.other.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-lg font-bold text-white/90">
                        {initials(c.other.name)}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate font-bold">{c.other.name}</h2>
                      {c.met_confirmed_at && (
                        <span className="shrink-0 rounded-full bg-fuchsia-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-fuchsia-300">
                          met 🎉
                        </span>
                      )}
                    </div>
                    <p className="truncate text-sm text-neutral-400">
                      {c.last
                        ? `${c.last.mine ? "You: " : ""}${c.last.body}`
                        : "Say hi 👋"}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
    </main>
  );
}
