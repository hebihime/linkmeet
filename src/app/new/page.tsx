"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import {
  createEvent,
  type AccessMode,
  type CreatedEvent,
} from "@/lib/actions";

// datetime-local value for "now" in the organizer's own timezone.
function localNow() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

const MODES: { value: AccessMode; label: string; blurb: string }[] = [
  {
    value: "open",
    label: "Open",
    blurb: "Anyone with the link joins with just their email.",
  },
  {
    value: "code",
    label: "Code",
    blurb: "One shared event code — print it at your venue.",
  },
  {
    value: "roster",
    label: "Roster",
    blurb: "You provide emails; each person gets a private code.",
  },
];

export default function NewEventPage() {
  const [name, setName] = useState("");
  const [startsAt, setStartsAt] = useState(localNow);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<AccessMode>("open");
  const [joinCode, setJoinCode] = useState("");
  const [emails, setEmails] = useState("");
  const [seed, setSeed] = useState(true);
  const [seedCount, setSeedCount] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedEvent | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    const iso = new Date(startsAt).toISOString();
    start(async () => {
      const res = await createEvent({
        name,
        startsAtIso: iso,
        accessMode: mode,
        logoUrl,
        joinCode: mode === "code" ? joinCode : undefined,
        emails: mode === "roster" ? emails : undefined,
        seedCount: seed ? seedCount : 0,
      });
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
      <h1 className="text-3xl font-bold tracking-tight">Create your event link</h1>
      <p className="text-sm text-neutral-400">
        Your event gets a link and a spot in the finder. Choose how attendees
        get in.
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
          Starts{" "}
          <span className="text-neutral-500">
            (swiping unlocks at this time — before it, attendees see the Explore
            lobby)
          </span>
        </span>
        <input
          type="datetime-local"
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
          className="rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 outline-none [color-scheme:dark] focus:border-neutral-400"
        />
      </label>

      <LogoField name={name} url={logoUrl} onChange={setLogoUrl} />

      {/* Access mode — the gate attendees pass at the door */}
      <div className="flex flex-col gap-2 text-sm">
        <span className="text-neutral-300">How attendees get in</span>
        <div className="grid grid-cols-3 gap-1 rounded-xl border border-neutral-800 bg-neutral-900 p-1">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setMode(m.value)}
              className={`rounded-lg px-3 py-2 font-medium transition ${
                mode === m.value
                  ? "bg-white text-black"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-neutral-500">
          {MODES.find((m) => m.value === mode)!.blurb}
        </p>
      </div>

      {mode === "code" && (
        <label className="flex flex-col gap-2 text-sm">
          <span className="text-neutral-300">
            Event code <span className="text-neutral-500">(optional)</span>
          </span>
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="Auto-generate if left blank"
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 font-mono tracking-widest outline-none focus:border-neutral-400"
          />
        </label>
      )}

      {mode === "roster" && (
        <label className="flex flex-col gap-2 text-sm">
          <span className="text-neutral-300">
            Attendee emails{" "}
            <span className="text-neutral-500">
              (one per line, or comma-separated)
            </span>
          </span>
          <textarea
            value={emails}
            onChange={(e) => setEmails(e.target.value)}
            rows={7}
            placeholder={"ada@example.com\ngrace@example.com"}
            className="resize-y rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 font-mono text-sm outline-none focus:border-neutral-400"
          />
        </label>
      )}

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
            <span className="text-neutral-500">
              about half will send you requests
            </span>
          </label>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        onClick={submit}
        disabled={pending}
        className="rounded-full bg-white px-6 py-3 font-semibold text-black transition hover:bg-neutral-200 disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create event link"}
      </button>
    </main>
  );
}

// Logo upload — same client pattern as the profile PhotoField, but with
// kind=logo (no session exists yet at /new) and a square preview that shows
// the finder's initials placeholder until an image lands.
function LogoField({
  name,
  url,
  onChange,
}: {
  name: string;
  url: string | null;
  onChange: (url: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const initials =
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?";

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "logo");
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      onChange(json.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <span className="text-neutral-300">
        Logo{" "}
        <span className="text-neutral-500">
          (optional — shown in the event finder)
        </span>
      </span>
      <div className="flex items-center gap-4">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-neutral-800 bg-gradient-to-br from-indigo-500 to-fuchsia-500">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="Event logo" className="h-full w-full object-cover" />
          ) : (
            <span className="text-2xl font-bold text-white">{initials}</span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="w-fit rounded-full border border-neutral-600 px-4 py-2 font-medium transition hover:border-neutral-300 disabled:opacity-50"
          >
            {busy ? "Uploading…" : url ? "Change logo" : "Upload logo"}
          </button>
          {error && <span className="text-xs text-red-400">{error}</span>}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={onFile}
        className="hidden"
      />
    </div>
  );
}

function CreatedView({ created }: { created: CreatedEvent }) {
  const [copied, setCopied] = useState<"link" | "code" | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const link =
    typeof window !== "undefined"
      ? `${window.location.origin}/${created.eventId}`
      : `/${created.eventId}`;

  // QR of the event link — the fastest path from venue signage to the app.
  useEffect(() => {
    QRCode.toDataURL(link, { margin: 1, width: 480 })
      .then(setQr)
      .catch(() => setQr(null));
  }, [link]);

  function copy(text: string, which: "link" | "code") {
    navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
  }

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
        Your event link is live — it&apos;s already in the finder on the home
        page.
      </p>

      <div className="flex items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3">
        <span className="flex-1 truncate font-mono text-sm">{link}</span>
        <button
          onClick={() => copy(link, "link")}
          className="shrink-0 text-sm text-neutral-300 hover:text-white"
        >
          {copied === "link" ? "Copied!" : "Copy"}
        </button>
      </div>

      {qr && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-neutral-800 bg-white p-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt={`QR code for ${link}`} className="h-52 w-52" />
          <p className="text-center text-xs text-neutral-500">
            Scan to open {created.name}
          </p>
        </div>
      )}

      {created.accessMode === "open" && (
        <p className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-3 text-sm text-neutral-300">
          Anyone with this link can join — share it anywhere.
        </p>
      )}

      {created.accessMode === "code" && created.joinCode && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-neutral-800 bg-neutral-900 px-5 py-6">
          <p className="text-sm uppercase tracking-widest text-neutral-500">
            Event code
          </p>
          <p className="font-mono text-4xl font-bold tracking-[0.3em]">
            {created.joinCode}
          </p>
          <button
            onClick={() => copy(created.joinCode!, "code")}
            className="text-sm text-neutral-400 hover:text-white"
          >
            {copied === "code" ? "Copied!" : "Copy code"}
          </button>
          <p className="text-center text-sm text-neutral-400">
            Print this at your venue — attendees enter it to join. It&apos;s
            shown only here.
          </p>
        </div>
      )}

      {created.accessMode === "roster" && (
        <>
          <p className="text-sm text-neutral-400">
            {created.codes.length} access code
            {created.codes.length === 1 ? "" : "s"} generated — give each
            person their own code.
          </p>
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
        </>
      )}
    </main>
  );
}
