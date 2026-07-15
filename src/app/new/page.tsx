"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { createEvent, type CreatedEvent } from "@/lib/actions";

export default function NewEventPage() {
  const [name, setName] = useState("");
  const [emails, setEmails] = useState("");
  const [seed, setSeed] = useState(true);
  const [seedCount, setSeedCount] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedEvent | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    start(async () => {
      const res = await createEvent(name, emails, seed ? seedCount : 0);
      if ("error" in res) setError(res.error);
      else setCreated(res);
    });
  }

  if (created) return <CreatedView created={created} />;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-6 py-10">
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-300">
        ← LinkMeet
      </Link>
      <h1 className="text-3xl font-bold tracking-tight">Create an event</h1>
      <p className="text-sm text-neutral-400">
        Name your event and paste your attendee emails. We&apos;ll generate one
        private access code per person.
      </p>

      <label className="flex flex-col gap-2 text-sm">
        <span className="text-neutral-300">Event name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="HIMSS 2026"
          className="rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 outline-none focus:border-neutral-400"
        />
      </label>

      <label className="flex flex-col gap-2 text-sm">
        <span className="text-neutral-300">
          Attendee emails{" "}
          <span className="text-neutral-500">(one per line, or comma-separated)</span>
        </span>
        <textarea
          value={emails}
          onChange={(e) => setEmails(e.target.value)}
          rows={7}
          placeholder={"ada@example.com\ngrace@example.com"}
          className="resize-y rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 font-mono text-sm outline-none focus:border-neutral-400"
        />
      </label>

      <div className="flex flex-col gap-3 rounded-lg border border-neutral-800 bg-neutral-900/50 p-4">
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={seed}
            onChange={(e) => setSeed(e.target.checked)}
            className="h-4 w-4 accent-white"
          />
          <span className="text-neutral-300">
            Add test attendees (for trying out swiping)
          </span>
        </label>
        {seed && (
          <label className="flex items-center gap-3 pl-7 text-sm text-neutral-400">
            <span>How many</span>
            <input
              type="number"
              min={1}
              max={50}
              value={seedCount}
              onChange={(e) =>
                setSeedCount(
                  Math.max(1, Math.min(50, Number(e.target.value) || 1)),
                )
              }
              className="w-20 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 outline-none focus:border-neutral-400"
            />
            <span className="text-neutral-500">about half will match you</span>
          </label>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        onClick={submit}
        disabled={pending}
        className="rounded-full bg-white px-6 py-3 font-semibold text-black transition hover:bg-neutral-200 disabled:opacity-50"
      >
        {pending ? "Generating codes…" : "Generate access codes"}
      </button>
    </main>
  );
}

function CreatedView({ created }: { created: CreatedEvent }) {
  const [copied, setCopied] = useState(false);
  const link =
    typeof window !== "undefined"
      ? `${window.location.origin}/${created.eventId}`
      : `/${created.eventId}`;

  function downloadCsv() {
    const rows = [
      ["email", "code", "link"],
      ...created.codes.map((c) => [c.email, c.code, `${link}`]),
    ];
    const csv = rows
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${created.eventId}-codes.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 px-6 py-10">
      <h1 className="text-3xl font-bold tracking-tight">{created.name}</h1>
      <p className="text-sm text-neutral-400">
        {created.codes.length} access code
        {created.codes.length === 1 ? "" : "s"} generated. Share the link below,
        and give each person their own code.
      </p>

      <div className="flex items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3">
        <span className="flex-1 truncate font-mono text-sm">{link}</span>
        <button
          onClick={() => {
            navigator.clipboard.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="shrink-0 text-sm text-neutral-300 hover:text-white"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>

      <button
        onClick={downloadCsv}
        className="rounded-full bg-white px-6 py-3 font-semibold text-black transition hover:bg-neutral-200"
      >
        Download codes (CSV)
      </button>

      <div className="overflow-hidden rounded-lg border border-neutral-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-900 text-neutral-400">
            <tr>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Code</th>
            </tr>
          </thead>
          <tbody>
            {created.codes.map((c) => (
              <tr key={c.email} className="border-t border-neutral-800">
                <td className="px-4 py-2">{c.email}</td>
                <td className="px-4 py-2 font-mono">{c.code}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="rounded-lg bg-amber-950/40 px-4 py-3 text-sm text-amber-200/80">
        Save this CSV now — the codes are shown here only once.
      </p>
    </main>
  );
}
