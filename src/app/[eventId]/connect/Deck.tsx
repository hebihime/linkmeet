"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import Link from "next/link";
import {
  sendIntent,
  fetchMoreCards,
  type Celebration,
  type IntentKind,
} from "@/lib/actions";
import type { Card } from "@/lib/queries";

type Dir = "up" | "right" | "down" | "left";

const KIND: Record<Dir, IntentKind> = {
  up: "meet",
  right: "link",
  down: "invite",
  left: "pass",
};

const COMMIT_DIST = 110; // px of drag that commits a swipe
const COMMIT_VEL = 0.55; // px/ms fling velocity that commits a swipe
const FLY_MS = 180; // fly-off animation
const REFILL_AT = 4; // fetch more when the queue gets this short

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
  initialCards,
}: {
  eventId: string;
  initialCards: Card[];
}) {
  const [stack, setStack] = useState<Card[]>(initialCards);
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const [composer, setComposer] = useState<Card | null>(null);
  const [drained, setDrained] = useState(initialCards.length === 0);

  const containerRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const overlayRefs = useRef<Record<Dir, HTMLDivElement | null>>({
    up: null,
    right: null,
    down: null,
    left: null,
  });
  const drag = useRef({
    active: false,
    pointerId: 0,
    x0: 0,
    y0: 0,
    dx: 0,
    dy: 0,
    vx: 0,
    vy: 0,
    t: 0,
  });
  const seenRef = useRef<Set<string>>(new Set(initialCards.map((c) => c.id)));
  const fetchingRef = useRef(false);
  // Mirror of `stack` for event handlers; updated at every mutation site
  // (advance/refill) rather than during render.
  const stackRef = useRef(initialCards);

  // ---- queue management ------------------------------------------------------

  const refill = useCallback(() => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    fetchMoreCards([...seenRef.current])
      .then((more) => {
        const fresh = more.filter((c) => !seenRef.current.has(c.id));
        fresh.forEach((c) => seenRef.current.add(c.id));
        if (fresh.length > 0) {
          const next = [...stackRef.current, ...fresh];
          stackRef.current = next;
          setStack(next);
          setDrained(false);
        } else if (stackRef.current.length === 0) {
          setDrained(true);
        }
      })
      .finally(() => {
        fetchingRef.current = false;
      });
  }, []);

  const advance = useCallback(
    (card: Card, dir: Dir, extra?: { message: string; photoUrl?: string }) => {
      const next = stackRef.current.filter((c) => c.id !== card.id);
      stackRef.current = next;
      setStack(next);
      if (next.length <= REFILL_AT) refill();
      if (next.length === 0) setDrained(true);
      // Optimistic: the write happens in the background; the deck never waits.
      sendIntent({
        targetId: card.id,
        kind: KIND[dir],
        message: extra?.message,
        photoUrl: extra?.photoUrl,
      }).then((res) => {
        if (res.celebration) setCelebration(res.celebration);
      });
    },
    [refill],
  );

  // Fly the card off-screen on a detached clone so the next card is live
  // immediately — no dead time between rapid swipes.
  const flyOff = useCallback(
    (dir: Dir, card: Card, extra?: { message: string; photoUrl?: string }) => {
      const el = topRef.current;
      const container = containerRef.current;
      if (el && container) {
        const clone = el.cloneNode(true) as HTMLElement;
        clone.style.pointerEvents = "none";
        clone.style.zIndex = "40";
        container.appendChild(clone);
        const { dx, dy } = drag.current;
        const targets: Record<Dir, string> = {
          left: `translate3d(${-window.innerWidth * 1.2}px, ${dy}px, 0) rotate(-24deg)`,
          right: `translate3d(${window.innerWidth * 1.2}px, ${dy}px, 0) rotate(24deg)`,
          up: `translate3d(${dx}px, ${-window.innerHeight}px, 0) rotate(${dx / 18}deg)`,
          down: `translate3d(${dx}px, ${window.innerHeight}px, 0) rotate(${dx / 18}deg)`,
        };
        requestAnimationFrame(() => {
          clone.style.transition = `transform ${FLY_MS}ms ease-in, opacity ${FLY_MS}ms ease-in`;
          clone.style.transform = targets[dir];
          clone.style.opacity = "0.6";
        });
        setTimeout(() => clone.remove(), FLY_MS + 80);
      }
      drag.current.dx = 0;
      drag.current.dy = 0;
      advance(card, dir, extra);
    },
    [advance],
  );

  // ---- gesture handling --------------------------------------------------------

  const setOverlays = useCallback((dx: number, dy: number, animate = false) => {
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const o = overlayRefs.current;
    const vals: Record<Dir, number> = {
      right: horizontal ? Math.min(1, Math.max(0, dx) / COMMIT_DIST) : 0,
      left: horizontal ? Math.min(1, Math.max(0, -dx) / COMMIT_DIST) : 0,
      up: horizontal ? 0 : Math.min(1, Math.max(0, -dy) / COMMIT_DIST),
      down: horizontal ? 0 : Math.min(1, Math.max(0, dy) / COMMIT_DIST),
    };
    (Object.keys(vals) as Dir[]).forEach((d) => {
      const node = o[d];
      if (!node) return;
      node.style.transition = animate ? "opacity 200ms ease" : "none";
      node.style.opacity = String(vals[d]);
    });
  }, []);

  const springBack = useCallback(() => {
    const el = topRef.current;
    if (el) {
      el.style.transition = "transform 320ms cubic-bezier(0.175, 0.885, 0.32, 1.275)";
      el.style.transform = "";
    }
    setOverlays(0, 0, true);
    drag.current.dx = 0;
    drag.current.dy = 0;
  }, [setOverlays]);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (composer || celebration) return;
    const el = topRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    el.style.transition = "none";
    drag.current = {
      active: true,
      pointerId: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      dx: 0,
      dy: 0,
      vx: 0,
      vy: 0,
      t: performance.now(),
    };
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d.active || e.pointerId !== d.pointerId) return;
    const now = performance.now();
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    const dt = Math.max(1, now - d.t);
    // Low-pass the instantaneous velocity so a final jitter doesn't dominate.
    d.vx = 0.7 * ((dx - d.dx) / dt) + 0.3 * d.vx;
    d.vy = 0.7 * ((dy - d.dy) / dt) + 0.3 * d.vy;
    d.dx = dx;
    d.dy = dy;
    d.t = now;
    const el = topRef.current;
    if (el) {
      // Direct transform mutation — no React re-render per pointer move.
      el.style.transform = `translate3d(${dx}px, ${dy}px, 0) rotate(${dx / 18}deg)`;
    }
    setOverlays(dx, dy);
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d.active || e.pointerId !== d.pointerId) return;
    d.active = false;
    const card = stackRef.current[0];
    if (!card) return;

    const { dx, dy, vx, vy } = d;
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    let dir: Dir | null = null;
    if (horizontal) {
      if (dx > COMMIT_DIST || (dx > 30 && vx > COMMIT_VEL)) dir = "right";
      else if (dx < -COMMIT_DIST || (dx < -30 && vx < -COMMIT_VEL)) dir = "left";
    } else {
      if (dy < -COMMIT_DIST || (dy < -30 && vy < -COMMIT_VEL)) dir = "up";
      else if (dy > COMMIT_DIST || (dy > 30 && vy > COMMIT_VEL)) dir = "down";
    }

    if (dir === "down") {
      // Invite needs a message first — spring back and open the composer.
      springBack();
      setComposer(card);
    } else if (dir) {
      flyOff(dir, card);
      setOverlays(0, 0);
    } else {
      springBack();
    }
  }

  // Buttons + keyboard drive the identical commit path as gestures.
  const act = useCallback(
    (dir: Dir) => {
      if (composer || celebration) return;
      const card = stackRef.current[0];
      if (!card) return;
      if (dir === "down") {
        setComposer(card);
        return;
      }
      flyOff(dir, card);
    },
    [composer, celebration, flyOff],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
        return;
      const map: Record<string, Dir> = {
        ArrowUp: "up",
        ArrowRight: "right",
        ArrowDown: "down",
        ArrowLeft: "left",
      };
      const dir = map[e.key];
      if (!dir) return;
      e.preventDefault();
      act(dir);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [act]);

  useEffect(() => {
    if (stack.length === 0 && !drained) refill();
  }, [stack.length, drained, refill]);

  // ---- render -------------------------------------------------------------------

  const stampBase =
    "pointer-events-none absolute rounded-xl border-4 px-3 py-1 text-2xl font-extrabold tracking-widest opacity-0";

  function renderCard(card: Card, i: number) {
    const isTop = i === 0;
    const rest = `scale(${1 - i * 0.05}) translateY(${i * 12}px)`;
    return (
      <div
        key={card.id}
        ref={isTop ? topRef : undefined}
        onPointerDown={isTop ? onPointerDown : undefined}
        onPointerMove={isTop ? onPointerMove : undefined}
        onPointerUp={isTop ? onPointerUp : undefined}
        onPointerCancel={isTop ? onPointerUp : undefined}
        className="absolute inset-0 select-none overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-900 [-webkit-touch-callout:none]"
        style={{
          zIndex: 10 - i,
          touchAction: "none",
          willChange: "transform",
          transform: isTop ? undefined : rest,
          // Constant across renders so React never clobbers the ref-driven
          // drag transform; pointerdown overrides it to "none" directly.
          transition: "transform 250ms ease",
        }}
      >
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-indigo-900 via-neutral-900 to-fuchsia-900">
          {card.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={card.photo_url}
              alt={card.name}
              draggable={false}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="text-7xl font-bold text-white/90">
              {initials(card.name)}
            </span>
          )}
        </div>

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-5 pb-5 pt-16">
          <h2 className="text-2xl font-bold">{card.name}</h2>
          {card.headline && (
            <p className="mt-0.5 text-sm text-neutral-300">{card.headline}</p>
          )}
          {card.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {card.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs text-white backdrop-blur-sm"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>

        {isTop && (
          <>
            <div
              ref={(n) => {
                overlayRefs.current.up = n;
              }}
              className={`${stampBase} left-1/2 top-8 -translate-x-1/2 border-fuchsia-400 text-fuchsia-300`}
            >
              MEET
            </div>
            <div
              ref={(n) => {
                overlayRefs.current.right = n;
              }}
              className={`${stampBase} left-5 top-8 -rotate-12 border-indigo-400 text-indigo-300`}
            >
              LINK
            </div>
            <div
              ref={(n) => {
                overlayRefs.current.left = n;
              }}
              className={`${stampBase} right-5 top-8 rotate-12 border-neutral-400 text-neutral-300`}
            >
              PASS
            </div>
            <div
              ref={(n) => {
                overlayRefs.current.down = n;
              }}
              className={`${stampBase} bottom-24 left-1/2 -translate-x-1/2 border-amber-400 text-amber-300`}
            >
              INVITE
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <main className="mx-auto flex h-dvh w-full max-w-md flex-col px-5 pb-24 pt-4">
      <header className="mb-3 text-center text-xs font-semibold uppercase tracking-widest text-neutral-600">
        Connect
      </header>

      <div ref={containerRef} className="relative min-h-0 flex-1">
        {stack.length > 0 ? (
          stack.slice(0, 3).map(renderCard)
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-neutral-800 px-8 text-center">
            <h2 className="text-2xl font-bold">
              {drained ? "You're all caught up" : "Finding people…"}
            </h2>
            <p className="text-neutral-400">
              {drained
                ? "You've seen everyone here for now. Check back as more people join."
                : ""}
            </p>
            {drained && (
              <Link
                href={`/${eventId}/chats`}
                className="mt-2 rounded-full bg-white px-6 py-3 font-semibold text-black transition hover:bg-neutral-200"
              >
                Go to your chats
              </Link>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-center gap-4">
        <DeckButton label="Pass" onClick={() => act("left")} className="border-neutral-700 text-neutral-300">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="h-6 w-6">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </DeckButton>
        <DeckButton label="Invite" onClick={() => act("down")} className="border-amber-500/60 text-amber-300">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6">
            <path d="M12 4v12m0 0l-5-5m5 5l5-5" />
            <path d="M4 20h16" />
          </svg>
        </DeckButton>
        <DeckButton label="Link" onClick={() => act("right")} className="border-indigo-500/60 text-indigo-300">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6">
            <path d="M9 15l6-6" />
            <path d="M10.5 6.5l1-1a4 4 0 015.7 5.7l-1 1M13.5 17.5l-1 1a4 4 0 01-5.7-5.7l1-1" />
          </svg>
        </DeckButton>
        <DeckButton
          label="Meet"
          onClick={() => act("up")}
          className="border-transparent bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-lg shadow-fuchsia-950/50"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="h-6 w-6">
            <path d="M12 20V6m0 0l-6 6m6-6l6 6" />
          </svg>
        </DeckButton>
      </div>
      <p className="mt-2 text-center text-[11px] text-neutral-600">
        ↑ Meet &nbsp;·&nbsp; → Link &nbsp;·&nbsp; ↓ Invite &nbsp;·&nbsp; ← Pass
      </p>

      {composer && (
        <InviteComposer
          card={composer}
          onCancel={() => setComposer(null)}
          onSend={(message, photoUrl) => {
            const card = composer;
            setComposer(null);
            flyOff("down", card, { message, photoUrl });
          }}
        />
      )}

      {celebration && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-black/90 px-6 text-center">
          <p className="bg-gradient-to-r from-indigo-400 to-fuchsia-400 bg-clip-text text-sm font-bold uppercase tracking-[0.3em] text-transparent">
            It&apos;s a connection!
          </p>
          <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-full border-2 border-fuchsia-500/60 bg-gradient-to-br from-indigo-800 to-fuchsia-800">
            {celebration.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={celebration.photoUrl}
                alt={celebration.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="text-4xl font-bold text-white/90">
                {initials(celebration.name)}
              </span>
            )}
          </div>
          <h2 className="text-3xl font-bold">
            You and {celebration.name} both want to connect
          </h2>
          <div className="flex gap-3">
            <button
              onClick={() => setCelebration(null)}
              className="rounded-full border border-neutral-600 px-6 py-3 font-semibold transition hover:border-neutral-300"
            >
              Keep swiping
            </button>
            <Link
              href={`/${eventId}/chats/${celebration.connectionId}`}
              className="rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-6 py-3 font-semibold text-white transition hover:brightness-110"
            >
              Say hi
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}

function DeckButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`flex h-14 w-14 items-center justify-center rounded-full border transition active:scale-90 ${className}`}
    >
      {children}
    </button>
  );
}

function InviteComposer({
  card,
  onCancel,
  onSend,
}: {
  card: Card;
  onCancel: () => void;
  onSend: (message: string, photoUrl?: string) => void;
}) {
  const [message, setMessage] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      setPhotoUrl(json.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 sm:items-center">
      <div className="w-full max-w-md rounded-t-3xl border border-neutral-800 bg-neutral-950 p-6 sm:rounded-3xl">
        <h2 className="text-xl font-bold">Invite {card.name}</h2>
        <p className="mt-1 text-sm text-neutral-400">
          Tell them what and where — it lands as the first message of your chat.
        </p>
        <textarea
          autoFocus
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          placeholder="Drinks at the north bar at 7?"
          className="mt-4 w-full resize-none rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-base outline-none focus:border-neutral-400"
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="rounded-full border border-neutral-700 px-4 py-2 text-sm text-neutral-300 transition hover:border-neutral-400 disabled:opacity-50"
          >
            {busy ? "Uploading…" : photoUrl ? "Change photo" : "Add photo"}
          </button>
          {photoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoUrl}
              alt="Invite"
              className="h-10 w-10 rounded-lg object-cover"
            />
          )}
          {error && <span className="text-xs text-red-400">{error}</span>}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={onFile}
          className="hidden"
        />
        <div className="mt-5 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 rounded-full border border-neutral-600 px-6 py-3 font-semibold transition hover:border-neutral-300"
          >
            Cancel
          </button>
          <button
            onClick={() => onSend(message.trim(), photoUrl ?? undefined)}
            disabled={!message.trim() || busy}
            className="flex-1 rounded-full bg-gradient-to-r from-amber-500 to-fuchsia-500 px-6 py-3 font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
          >
            Send invite
          </button>
        </div>
      </div>
    </div>
  );
}
