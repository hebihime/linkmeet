"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { respondToRequest } from "@/lib/actions";
import type { RequestItem } from "@/lib/queries";

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default function RequestList({
  eventId,
  initial,
}: {
  eventId: string;
  initial: RequestItem[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [, start] = useTransition();
  const [actingOn, setActingOn] = useState<string | null>(null);

  function respond(item: RequestItem, accept: boolean) {
    setActingOn(item.id);
    start(async () => {
      const res = await respondToRequest(item.id, accept);
      setItems((list) => list.filter((r) => r.id !== item.id));
      setActingOn(null);
      if (accept && res.connectionId) {
        router.push(`/${eventId}/chats/${res.connectionId}`);
      } else {
        router.refresh(); // keep the nav badge honest
      }
    });
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-neutral-800 px-8 py-16 text-center">
        <h2 className="text-xl font-bold">No requests right now</h2>
        <p className="text-sm text-neutral-400">
          When someone sends you a Meet, Link, or invite, it lands here.
        </p>
        <Link
          href={`/${eventId}/connect`}
          className="mt-2 rounded-full bg-white px-6 py-3 font-semibold text-black transition hover:bg-neutral-200"
        >
          Go connect
        </Link>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-4">
      {items.map((item) => (
        <li
          key={item.id}
          className="overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-900"
        >
          <div className="flex items-center gap-4 p-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-800 to-fuchsia-800">
              {item.sender.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.sender.photo_url}
                  alt={item.sender.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-xl font-bold text-white/90">
                  {initials(item.sender.name)}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="truncate font-bold">{item.sender.name}</h2>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                    item.kind === "meet"
                      ? "bg-fuchsia-500/20 text-fuchsia-300"
                      : item.kind === "invite"
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "bg-indigo-500/20 text-indigo-300"
                  }`}
                >
                  {item.kind === "invite" ? "invited you" : item.kind}
                </span>
              </div>
              {item.sender.headline && (
                <p className="truncate text-sm text-neutral-400">
                  {item.sender.headline}
                </p>
              )}
              {item.sender.tags.length > 0 && (
                <p className="mt-0.5 truncate text-xs text-neutral-500">
                  {item.sender.tags.join(" · ")}
                </p>
              )}
            </div>
          </div>
          {item.kind === "invite" && item.message && (
            <p className="border-t border-neutral-800 px-4 py-3 text-sm text-neutral-300">
              <span className="mr-1 text-neutral-500">“</span>
              {item.message}
              <span className="ml-0.5 text-neutral-500">”</span>
            </p>
          )}
          <div className="flex border-t border-neutral-800">
            <button
              onClick={() => respond(item, false)}
              disabled={actingOn === item.id}
              className="flex-1 py-3 text-sm font-semibold text-neutral-400 transition hover:bg-neutral-800/50 hover:text-neutral-200 disabled:opacity-50"
            >
              Decline
            </button>
            <div className="w-px bg-neutral-800" />
            <button
              onClick={() => respond(item, true)}
              disabled={actingOn === item.id}
              className="flex-1 py-3 text-sm font-semibold text-fuchsia-300 transition hover:bg-fuchsia-500/10 disabled:opacity-50"
            >
              Accept
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
