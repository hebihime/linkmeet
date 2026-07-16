import Link from "next/link";
import { getSession } from "@/lib/session";
import { getPendingRequestCount } from "@/lib/queries";

type Tab = "explore" | "connect" | "requests" | "chats" | "profile";

const ICONS: Record<Tab, React.ReactNode> = {
  explore: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6">
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2 5-5 2 2-5 5-2z" fill="currentColor" stroke="none" />
    </svg>
  ),
  connect: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-7 w-7">
      <rect x="6.5" y="4" width="12" height="16" rx="2.5" />
      <path d="M4 7.5v11A2.5 2.5 0 0 0 6.5 21" opacity="0.5" />
    </svg>
  ),
  requests: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6">
      <path d="M3 8l9 6 9-6" />
      <rect x="3" y="5" width="18" height="14" rx="2" />
    </svg>
  ),
  chats: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6">
      <path d="M21 12a8 8 0 0 1-8 8H4l1.6-3.2A8 8 0 1 1 21 12z" />
    </svg>
  ),
  profile: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" />
    </svg>
  ),
};

const LABELS: Record<Tab, string> = {
  explore: "Explore",
  connect: "Connect",
  requests: "Requests",
  chats: "Chats",
  profile: "Profile",
};

const ORDER: Tab[] = ["explore", "connect", "requests", "chats", "profile"];

export default async function BottomNav({
  eventId,
  active,
}: {
  eventId: string;
  active: Tab;
}) {
  const session = await getSession();
  const pending =
    session?.profileId && session.eventId === eventId
      ? await getPendingRequestCount(eventId, session.profileId)
      : 0;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-neutral-800 bg-neutral-950/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-md items-stretch justify-between px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2">
        {ORDER.map((tab) => {
          const isActive = tab === active;
          const isCenter = tab === "connect";
          return (
            <Link
              key={tab}
              href={`/${eventId}/${tab}`}
              className={`relative flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1 text-[11px] font-medium transition-colors ${
                isActive ? "text-white" : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              <span
                className={
                  isCenter
                    ? `-mt-5 flex h-12 w-12 items-center justify-center rounded-full shadow-lg shadow-fuchsia-950/40 ${
                        isActive
                          ? "bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white"
                          : "bg-gradient-to-br from-indigo-600/80 to-fuchsia-600/80 text-white/90"
                      }`
                    : ""
                }
              >
                {ICONS[tab]}
              </span>
              {tab === "requests" && pending > 0 && (
                <span className="absolute right-1/2 top-0 flex h-4 min-w-4 -translate-y-1 translate-x-4 items-center justify-center rounded-full bg-fuchsia-500 px-1 text-[10px] font-bold text-white">
                  {pending > 9 ? "9+" : pending}
                </span>
              )}
              <span>{LABELS[tab]}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
