"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { swipe } from "@/lib/actions";
import type { Card } from "@/lib/queries";

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default function Deck({
  eventId,
  initialCard,
}: {
  eventId: string;
  initialCard: Card | null;
}) {
  const [card, setCard] = useState<Card | null>(initialCard);
  const [match, setMatch] = useState<{ name: string } | null>(null);
  const [pending, start] = useTransition();

  function act(liked: boolean) {
    if (!card || pending) return;
    const target = card.id;
    start(async () => {
      const res = await swipe(target, liked);
      if (res.match) setMatch({ name: res.match.name });
      setCard(res.next);
    });
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-6 py-6">
      <header className="mb-4 flex items-center justify-between">
        <Link
          href={`/${eventId}/profile`}
          className="text-sm text-neutral-400 hover:text-white"
        >
          Profile
        </Link>
        <span className="text-sm font-semibold uppercase tracking-widest text-neutral-500">
          LinkMeet
        </span>
        <Link
          href={`/${eventId}/matches`}
          className="text-sm text-neutral-400 hover:text-white"
        >
          Matches
        </Link>
      </header>

      <div className="flex flex-1 flex-col justify-center">
        {card ? (
          <>
            <div className="overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-900">
              <div className="flex aspect-[4/5] items-center justify-center bg-gradient-to-br from-indigo-900 via-neutral-900 to-fuchsia-900">
                {card.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={card.photo_url}
                    alt={card.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-6xl font-bold text-white/90">
                    {initials(card.name)}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-3 p-5">
                <div>
                  <h2 className="text-2xl font-bold">{card.name}</h2>
                  {card.headline && (
                    <p className="text-neutral-400">{card.headline}</p>
                  )}
                </div>
                {card.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {card.tags.map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-neutral-800 px-3 py-1 text-sm text-neutral-300"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 flex items-center justify-center gap-6">
              <button
                onClick={() => act(false)}
                disabled={pending}
                aria-label="Pass"
                className="flex h-16 w-16 items-center justify-center rounded-full border border-neutral-700 text-2xl transition hover:border-neutral-400 disabled:opacity-40"
              >
                ✕
              </button>
              <button
                onClick={() => act(true)}
                disabled={pending}
                className="flex h-16 items-center justify-center rounded-full bg-white px-8 text-lg font-semibold text-black transition hover:bg-neutral-200 disabled:opacity-40"
              >
                Meet
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 text-center">
            <h2 className="text-2xl font-bold">You&apos;re all caught up</h2>
            <p className="text-neutral-400">
              You&apos;ve seen everyone here for now. Check back as more people
              join.
            </p>
            <Link
              href={`/${eventId}/matches`}
              className="mt-2 rounded-full bg-white px-6 py-3 font-semibold text-black transition hover:bg-neutral-200"
            >
              See your matches
            </Link>
          </div>
        )}
      </div>

      {match && (
        <div className="fixed inset-0 z-10 flex flex-col items-center justify-center gap-5 bg-black/85 px-6 text-center">
          <p className="text-sm uppercase tracking-widest text-fuchsia-400">
            It&apos;s a match
          </p>
          <h2 className="text-3xl font-bold">You and {match.name} both want to meet</h2>
          <div className="flex gap-3">
            <button
              onClick={() => setMatch(null)}
              className="rounded-full border border-neutral-600 px-6 py-3 font-semibold transition hover:border-neutral-300"
            >
              Keep swiping
            </button>
            <Link
              href={`/${eventId}/matches`}
              className="rounded-full bg-white px-6 py-3 font-semibold text-black transition hover:bg-neutral-200"
            >
              Say hi
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}
