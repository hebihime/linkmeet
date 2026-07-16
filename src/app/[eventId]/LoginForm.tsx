"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/lib/actions";

export default function LoginForm({
  eventId,
  eventName,
}: {
  eventId: string;
  eventName: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    start(async () => {
      const res = await login(eventId, email, code);
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
      <p className="text-sm text-neutral-400">
        Enter the email you were invited with and your private access code.
      </p>

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

      <label className="flex flex-col gap-2 text-sm">
        <span className="text-neutral-300">Access code</span>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="XXXXXXXX"
          className="rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 font-mono tracking-widest outline-none focus:border-neutral-400"
        />
      </label>

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
