"use client";

import { useState } from "react";
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

// Full-screen tap-through profile: photo carousel up top (tap left/right
// halves to page, Tinder-style), info below, and the four deck actions —
// this is where the buttons went when the deck itself became gesture-only.
export default function ProfileView({
  card,
  onClose,
  onAct,
}: {
  card: Card;
  onClose: () => void;
  onAct: (dir: "up" | "right" | "down" | "left") => void;
}) {
  const photos =
    card.photos.length > 0
      ? card.photos
      : card.photo_url
        ? [card.photo_url]
        : [];
  const [index, setIndex] = useState(0);

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/90">
      <div className="flex h-full w-full max-w-md flex-col overflow-y-auto bg-neutral-950">
        <div className="relative aspect-[3/4] w-full shrink-0 overflow-hidden">
          {photos.length > 0 ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photos[index]}
              alt={card.name}
              draggable={false}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-indigo-900 via-neutral-900 to-fuchsia-900">
              <span className="text-7xl font-bold text-white/90">
                {initials(card.name)}
              </span>
            </div>
          )}

          {photos.length > 1 && (
            <>
              <div className="absolute inset-x-0 top-0 flex gap-1.5 p-3">
                {photos.map((_, i) => (
                  <span
                    key={i}
                    className={`h-1 flex-1 rounded-full ${
                      i === index ? "bg-white" : "bg-white/30"
                    }`}
                  />
                ))}
              </div>
              <button
                aria-label="Previous photo"
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
                className="absolute inset-y-0 left-0 w-1/2"
              />
              <button
                aria-label="Next photo"
                onClick={() =>
                  setIndex((i) => Math.min(photos.length - 1, i + 1))
                }
                className="absolute inset-y-0 right-0 w-1/2"
              />
            </>
          )}

          <button
            onClick={onClose}
            aria-label="Close profile"
            className="absolute right-3 top-6 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md transition hover:bg-black/70"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-3 px-5 pb-32 pt-4">
          <h2 className="text-3xl font-bold">{card.name}</h2>
          {card.headline && (
            <p className="text-base text-neutral-300">{card.headline}</p>
          )}
          {card.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {card.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-white/10 px-3 py-1 text-sm text-neutral-200"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="fixed inset-x-0 bottom-0 z-10 flex justify-center bg-gradient-to-t from-neutral-950 via-neutral-950/90 to-transparent pb-[max(env(safe-area-inset-bottom),1rem)] pt-8">
          <div className="flex w-full max-w-md items-center justify-center gap-4">
            <ActionButton label="Pass" className="border-neutral-600 text-neutral-300" onClick={() => onAct("left")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="h-6 w-6">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </ActionButton>
            <ActionButton label="Invite" className="border-amber-500 text-amber-400" onClick={() => onAct("down")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6">
                <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <rect x="4" y="7" width="16" height="13" rx="2" />
                <path d="M12 11v5M9.5 13.5h5" />
              </svg>
            </ActionButton>
            <ActionButton label="Link" className="border-indigo-500 text-indigo-400" onClick={() => onAct("right")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6">
                <path d="M10 14a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" />
                <path d="M14 10a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" />
              </svg>
            </ActionButton>
            <ActionButton label="Meet" className="border-fuchsia-500 text-fuchsia-400" onClick={() => onAct("up")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6">
                <path d="M12 21s-7-4.6-9.5-9A5.5 5.5 0 0 1 12 6.6 5.5 5.5 0 0 1 21.5 12c-2.5 4.4-9.5 9-9.5 9z" />
              </svg>
            </ActionButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActionButton({
  label,
  className,
  onClick,
  children,
}: {
  label: string;
  className: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`flex flex-col items-center gap-1 text-[11px] font-medium`}
    >
      <span
        className={`flex h-14 w-14 items-center justify-center rounded-full border-2 bg-neutral-950/80 transition hover:brightness-125 ${className}`}
      >
        {children}
      </span>
      <span className="text-neutral-400">{label}</span>
    </button>
  );
}
