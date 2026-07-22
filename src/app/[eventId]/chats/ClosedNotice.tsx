"use client";

import { useRouter } from "next/navigation";

// Shown when the reported/blocked side lands here after their open thread was
// closed out from under them. Deliberately neutral — it never says who closed
// it or that a report was filed. Dismissing strips the ?closed=1 param so a
// refresh doesn't resurface it.
export default function ClosedNotice({ eventId }: { eventId: string }) {
  const router = useRouter();
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-neutral-800 bg-neutral-900 px-4 py-3">
      <span className="mt-0.5 text-neutral-400">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v5M12 16h.01" />
        </svg>
      </span>
      <p className="flex-1 text-sm text-neutral-300">
        This conversation is no longer available.
      </p>
      <button
        onClick={() => router.replace(`/${eventId}/chats`)}
        aria-label="Dismiss"
        className="shrink-0 rounded-full p-1 text-neutral-500 transition hover:bg-neutral-800 hover:text-white"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
