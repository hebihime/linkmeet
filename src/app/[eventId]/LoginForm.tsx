"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { login, type AccessMode } from "@/lib/actions";

// Per-mode copy. The gate differs; the email-as-identity flow doesn't.
const COPY: Record<
  AccessMode,
  { intro: (name: string) => string; codeLabel: string | null; codeHint: string }
> = {
  open: {
    intro: (name) => `Enter your email to join ${name}.`,
    codeLabel: null,
    codeHint: "",
  },
  code: {
    intro: () => "Enter your email and the event code.",
    codeLabel: "Event code",
    codeHint: "It's posted at your venue",
  },
  roster: {
    intro: () =>
      "Enter the email you were invited with and your private access code.",
    codeLabel: "Access code",
    codeHint: "",
  },
};

export default function LoginForm({
  eventId,
  eventName,
  accessMode,
}: {
  eventId: string;
  eventName: string;
  accessMode: AccessMode;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const copy = COPY[accessMode];

  function submit() {
    setError(null);
    start(async () => {
      const res = await login(eventId, email, accessMode === "open" ? "" : code);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      router.push(`/${eventId}/${res.hasProfile ? "explore" : "profile"}`);
    });
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-6 py-10">
      <div>
        <p className="text-sm uppercase tracking-widest text-neutral-500">
          LinkMeet
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">{eventName}</h1>
      </div>
      <p className="text-sm text-neutral-400">{copy.intro(eventName)}</p>

      <label className="flex flex-col gap-2 text-sm">
        <span className="text-neutral-300">Email</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 outline-none focus:border-neutral-400"
        />
      </label>

      {copy.codeLabel && (
        <label className="flex flex-col gap-2 text-sm">
          <span className="text-neutral-300">
            {copy.codeLabel}
            {copy.codeHint && (
              <span className="text-neutral-500"> ({copy.codeHint})</span>
            )}
          </span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="XXXXXXXX"
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 font-mono tracking-widest outline-none focus:border-neutral-400"
          />
        </label>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        onClick={submit}
        disabled={pending}
        className="rounded-full bg-white px-6 py-3 font-semibold text-black transition hover:bg-neutral-200 disabled:opacity-50"
      >
        {pending ? "Checking…" : "Enter"}
      </button>
    </main>
  );
}
