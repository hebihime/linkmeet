"use client";

import { useRef, type PointerEvent as ReactPointerEvent, type KeyboardEvent } from "react";

const MIN = 18;
const MAX = 65; // top thumb parked here means open-ended ("65+")

// Dual-thumb age range. A thumb resting at its extreme reports null, so the
// all-the-way-open state is "no age filter" and the badge stays off.
export default function AgeRange({
  ageMin,
  ageMax,
  onChange,
}: {
  ageMin: number | null;
  ageMax: number | null;
  onChange: (ageMin: number | null, ageMax: number | null) => void;
}) {
  const lo = Math.min(Math.max(ageMin ?? MIN, MIN), MAX);
  const hi = Math.min(Math.max(ageMax ?? MAX, lo), MAX);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<"lo" | "hi" | null>(null);

  const commit = (nextLo: number, nextHi: number) => {
    onChange(nextLo === MIN ? null : nextLo, nextHi === MAX ? null : nextHi);
  };

  const valueAt = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(MIN + ratio * (MAX - MIN));
  };

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    dragging.current = e.currentTarget.dataset.thumb as "lo" | "hi";
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging.current || !trackRef.current) return;
    const v = valueAt(e.clientX);
    if (dragging.current === "lo") commit(Math.min(v, hi), hi);
    else commit(lo, Math.max(v, lo));
  }

  function onPointerUp() {
    dragging.current = null;
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const delta =
      e.key === "ArrowLeft" || e.key === "ArrowDown"
        ? -1
        : e.key === "ArrowRight" || e.key === "ArrowUp"
          ? 1
          : 0;
    if (!delta) return;
    e.preventDefault();
    if (e.currentTarget.dataset.thumb === "lo")
      commit(Math.min(Math.max(MIN, lo + delta), hi), hi);
    else commit(lo, Math.min(Math.max(lo, hi + delta), MAX));
  }

  const pct = (v: number) => ((v - MIN) / (MAX - MIN)) * 100;
  const thumbClass =
    "absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full bg-white shadow-md outline-none ring-fuchsia-400 focus-visible:ring-2";

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-neutral-300">
        {lo} – {hi === MAX ? "65+" : hi}
      </p>
      <div className="px-3 py-2" style={{ touchAction: "none" }}>
        <div ref={trackRef} className="relative h-1 rounded-full bg-neutral-700">
          <div
            className="absolute inset-y-0 rounded-full bg-fuchsia-500"
            style={{ left: `${pct(lo)}%`, right: `${100 - pct(hi)}%` }}
          />
          <div
            role="slider"
            tabIndex={0}
            data-thumb="lo"
            aria-label="Minimum age"
            aria-valuemin={MIN}
            aria-valuemax={hi}
            aria-valuenow={lo}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onKeyDown}
            className={thumbClass}
            // When both thumbs overlap in the upper half, the min thumb must
            // win the tap or it's unreachable under the max thumb.
            style={{ left: `${pct(lo)}%`, zIndex: lo === hi && lo > (MIN + MAX) / 2 ? 2 : 1 }}
          />
          <div
            role="slider"
            tabIndex={0}
            data-thumb="hi"
            aria-label="Maximum age"
            aria-valuemin={lo}
            aria-valuemax={MAX}
            aria-valuenow={hi}
            aria-valuetext={hi === MAX ? "65 plus" : String(hi)}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onKeyDown}
            className={thumbClass}
            style={{ left: `${pct(hi)}%` }}
          />
        </div>
      </div>
    </div>
  );
}
