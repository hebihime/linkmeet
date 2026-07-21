"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// Near-real-time without websockets: one lightweight poll drives both the live
// nav badges and the match toast. Safe-by-default at scale — it pauses on a
// hidden tab (Page Visibility), jitters so clients never synchronize into a
// thundering herd, and backs off exponentially on error instead of hammering.
const BASE_MS = 12_000;
const JITTER_MS = 3_000;
const MAX_BACKOFF_MS = 120_000;
const TOAST_MS = 7_000;

type Toast = { id: string; name: string; photo_url: string | null };

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default function MatchNotifier({
  eventId,
  initialPending,
  initialUnread,
}: {
  eventId: string;
  initialPending: number;
  initialUnread: number;
}) {
  const router = useRouter();
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Cursor = latest DB time we've accounted for; null until the baseline poll.
  const cursorRef = useRef<string | null>(null);
  // Guards against re-toasting the same match if the cursor math ever races.
  const seenRef = useRef<Set<string>>(new Set());
  // Last badge counts we know the server rendered — only refresh when they move.
  const countsRef = useRef({ pending: initialPending, unread: initialUnread });

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;

    const schedule = (ms: number) => {
      timer = setTimeout(run, ms);
    };
    const jittered = () => BASE_MS + Math.floor(Math.random() * JITTER_MS);

    async function run() {
      if (stopped) return;
      // Don't poll a backgrounded tab; visibilitychange resumes the loop.
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const qs = cursorRef.current
          ? `?since=${encodeURIComponent(cursorRef.current)}`
          : "";
        const res = await fetch(`/${eventId}/poll${qs}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`poll ${res.status}`);
        const data = (await res.json()) as {
          serverTime: string;
          pending: number;
          unreadChats: number;
          matches: (Toast & { created_at: string })[];
        };
        failures = 0;

        // Advance the cursor past the newest thing we saw (server clock or a
        // match's own timestamp) so nothing is ever reported twice.
        let cursor = data.serverTime;
        const fresh: Toast[] = [];
        for (const m of data.matches ?? []) {
          if (m.created_at > cursor) cursor = m.created_at;
          if (!seenRef.current.has(m.id)) {
            seenRef.current.add(m.id);
            fresh.push({ id: m.id, name: m.name, photo_url: m.photo_url });
          }
        }
        cursorRef.current = cursor;
        if (fresh.length) setToasts((t) => [...t, ...fresh]);

        // Keep the nav badges live: only re-run the server shell when a count
        // actually changed (rare), never on every poll.
        if (
          data.pending !== countsRef.current.pending ||
          data.unreadChats !== countsRef.current.unread
        ) {
          countsRef.current = {
            pending: data.pending,
            unread: data.unreadChats,
          };
          router.refresh();
        }

        schedule(jittered());
      } catch {
        failures += 1;
        schedule(Math.min(BASE_MS * 2 ** failures, MAX_BACKOFF_MS));
      }
    }

    // First poll (since=null) just establishes the baseline cursor — no toasts.
    schedule(500 + Math.floor(Math.random() * JITTER_MS));

    const onVisibility = () => {
      if (!stopped && !document.hidden) {
        clearTimeout(timer);
        schedule(200);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [eventId, router]);

  const dismiss = (id: string) =>
    setToasts((t) => t.filter((x) => x.id !== id));

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-30 flex flex-col items-center gap-2 px-3 pt-[max(env(safe-area-inset-top),0.75rem)]">
      {toasts.map((t) => (
        <MatchToast
          key={t.id}
          eventId={eventId}
          toast={t}
          onDismiss={() => dismiss(t.id)}
        />
      ))}
    </div>
  );
}

function MatchToast({
  eventId,
  toast,
  onDismiss,
}: {
  eventId: string;
  toast: Toast;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const id = setTimeout(onDismiss, TOAST_MS);
    return () => clearTimeout(id);
  }, [onDismiss]);

  return (
    <Link
      href={`/${eventId}/chats/${toast.id}`}
      onClick={onDismiss}
      className="pointer-events-auto flex w-full max-w-md animate-[slideDown_0.25s_ease-out] items-center gap-3 rounded-2xl border border-fuchsia-500/40 bg-gradient-to-r from-indigo-600/95 to-fuchsia-600/95 px-4 py-3 shadow-lg shadow-fuchsia-900/40 backdrop-blur-md"
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-black/20">
        {toast.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={toast.photo_url}
            alt={toast.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="text-sm font-bold text-white">
            {initials(toast.name)}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold leading-tight text-white">
          New match 🎉
        </p>
        <p className="truncate text-xs text-white/80">
          You and {toast.name.split(" ")[0]} connected — say hi →
        </p>
      </div>
    </Link>
  );
}
