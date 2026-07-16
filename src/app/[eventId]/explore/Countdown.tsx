"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

function parts(msLeft: number) {
  const s = Math.max(0, Math.floor(msLeft / 1000));
  return {
    d: Math.floor(s / 86400),
    h: Math.floor((s % 86400) / 3600),
    m: Math.floor((s % 3600) / 60),
    s: s % 60,
  };
}

export default function Countdown({ target }: { target: string }) {
  const router = useRouter();
  const targetMs = new Date(target).getTime();
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    // First paint shows placeholders; the fast interval fills in almost
    // immediately without a synchronous setState in the effect body.
    const id = setInterval(() => {
      const remaining = targetMs - Date.now();
      setLeft(remaining);
      if (remaining <= 0) {
        clearInterval(id);
        router.refresh(); // flips the page to the "Connect is live" state
      }
    }, 250);
    return () => clearInterval(id);
  }, [targetMs, router]);

  const t = parts(left ?? 0);
  const seg = (n: number, label: string) => (
    <div className="flex flex-col items-center">
      <span className="text-3xl font-bold tabular-nums tracking-tight">
        {left === null ? "–" : String(n).padStart(2, "0")}
      </span>
      <span className="text-xs uppercase tracking-widest text-neutral-500">
        {label}
      </span>
    </div>
  );

  return (
    <div className="mt-3 flex items-center gap-5">
      {seg(t.d, "days")}
      {seg(t.h, "hrs")}
      {seg(t.m, "min")}
      {seg(t.s, "sec")}
    </div>
  );
}
