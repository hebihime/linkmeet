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
    <div className="flex flex-col gap-7">
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
          className="-mx-6 flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="list"
          aria-label="Events"
        >
          {matches.map((e) => (
            <Link
              key={e.id}
              href={`/${e.id}`}
              role="listitem"
              className="group flex w-48 shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 transition hover:border-neutral-600"
            >
              {e.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={e.logo_url}
                  alt=""
                  className="aspect-[3/4] w-full object-cover"
                />
              ) : (
                <div className="flex aspect-[3/4] w-full items-center justify-center bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-5xl font-bold text-white">
                  {initials(e.name)}
                </div>
              )}
              <span className="line-clamp-2 px-4 py-3 text-center text-base font-medium leading-tight text-neutral-200">
                {e.name}
              </span>
            </Link>
          ))}
        </div>
      )}

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search for your event"
        aria-label="Search for your event"
        className="rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 outline-none focus:border-neutral-400"
      />
    </div>
  );
}
