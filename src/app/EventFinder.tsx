"use client";

import { useState } from "react";
import Link from "next/link";
import type { EventListItem } from "@/lib/queries";

// "AI Con 2026" -> "AC"; "Defragcon" -> "D". First letters of the first one
// or two words — the placeholder tile for events without a logo.
function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export default function EventFinder({ events }: { events: EventListItem[] }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches = q
    ? events.filter((e) => e.name.toLowerCase().includes(q))
    : events;

  return (
    <div className="flex flex-col gap-8">
      {/* Step 1 — find your event's link */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-neutral-500">
          Step 1 · Link
        </h2>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for your event…"
          aria-label="Search for your event"
          className="rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 outline-none focus:border-neutral-400"
        />

        {events.length === 0 ? (
          <p className="py-6 text-center text-sm text-neutral-500">
            No events yet.
          </p>
        ) : matches.length === 0 ? (
          <p className="py-6 text-center text-sm text-neutral-500">
            No events match &lsquo;{query.trim()}&rsquo;
          </p>
        ) : (
          <div
            className="-mx-6 flex snap-x snap-mandatory gap-3 overflow-x-auto px-6 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            role="list"
            aria-label="Events"
          >
            {matches.map((e) => (
              <Link
                key={e.id}
                href={`/${e.id}`}
                role="listitem"
                className="flex w-28 shrink-0 snap-start flex-col items-center gap-2"
              >
                {e.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={e.logo_url}
                    alt=""
                    className="h-28 w-28 rounded-2xl border border-neutral-800 bg-neutral-900 object-cover transition hover:border-neutral-600"
                  />
                ) : (
                  <div className="flex h-28 w-28 items-center justify-center rounded-2xl border border-neutral-800 bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-3xl font-bold text-white">
                    {initials(e.name)}
                  </div>
                )}
                <span className="line-clamp-2 w-full text-center text-xs leading-tight text-neutral-300">
                  {e.name}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Step 2 — once you're in, the deck does the rest */}
      <section className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-neutral-500">
          Step 2 · Meet
        </h2>
        <p className="text-neutral-300">Tap in and start swiping.</p>
        <p className="text-sm text-neutral-500">
          Meet, Link, or Invite the people around you — async, rejection-safe,
          and gone when the event ends.
        </p>
      </section>
    </div>
  );
}
