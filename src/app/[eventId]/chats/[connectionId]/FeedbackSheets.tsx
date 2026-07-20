"use client";

import { useState } from "react";
import { submitRating, submitSafetyReport } from "@/lib/actions";
import { POSITIVE_TAGS, REPORT_REASONS } from "@/lib/feedback";

function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-t-3xl border border-neutral-800 bg-neutral-950 px-6 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-800 hover:text-white"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Positive endorsement — private and double-blind: aggregates into their
// reputation, never shown as "X said Y about you".
export function RatingSheet({
  connectionId,
  otherName,
  onRated,
  onClose,
}: {
  connectionId: string;
  otherName: string;
  onRated: () => void;
  onClose: () => void;
}) {
  const [endorse, setEndorse] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstName = otherName.split(" ")[0];

  async function submit() {
    setBusy(true);
    const res = await submitRating(connectionId, endorse, picked);
    setBusy(false);
    if ("error" in res) return setError(res.error);
    onRated();
    onClose();
  }

  return (
    <Sheet title={`How was meeting ${firstName}?`} onClose={onClose}>
      <div className="flex flex-col gap-4 pb-2">
        <p className="text-xs text-neutral-500">
          Private — {firstName} never sees who said what.
        </p>
        <button
          onClick={() => setEndorse(!endorse)}
          className={`rounded-full px-6 py-3 font-semibold transition ${
            endorse
              ? "bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-white"
              : "border border-neutral-700 text-neutral-400"
          }`}
        >
          {endorse ? "✓ Would connect again" : "Would connect again?"}
        </button>
        <div className="flex flex-wrap gap-2">
          {POSITIVE_TAGS.map((t) => {
            const on = picked.includes(t.key);
            return (
              <button
                key={t.key}
                onClick={() =>
                  setPicked((p) =>
                    on ? p.filter((k) => k !== t.key) : [...p, t.key],
                  )
                }
                className={`rounded-full border px-3 py-1.5 text-sm transition ${
                  on
                    ? "border-fuchsia-500 bg-fuchsia-500/15 text-fuchsia-300"
                    : "border-neutral-700 text-neutral-400 hover:border-neutral-500"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          onClick={submit}
          disabled={busy}
          className="rounded-full bg-white px-6 py-3 font-semibold text-black transition hover:bg-neutral-200 disabled:opacity-60"
        >
          {busy ? "Sending…" : "Submit"}
        </button>
      </div>
    </Sheet>
  );
}

// Safety report — the separate channel. Available on any connection (no
// verified meet required: harassment in chat never met you). Routed to
// review; repeated distinct reports auto-suspend pending review.
export function ReportSheet({
  connectionId,
  otherName,
  onClose,
  onDone,
}: {
  connectionId: string;
  otherName: string;
  onClose: () => void;
  // Fires after a successful report — the conversation is now deleted, so the
  // parent navigates away from the dead thread.
  onDone: () => void;
}) {
  const [reason, setReason] = useState<string | null>(null);
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstName = otherName.split(" ")[0];

  async function submit() {
    if (!reason) return setError("Pick what happened.");
    setBusy(true);
    const res = await submitSafetyReport(connectionId, reason, detail);
    setBusy(false);
    if ("error" in res) return setError(res.error);
    setSent(true);
  }

  return (
    <Sheet title={`Report ${firstName}`} onClose={sent ? onDone : onClose}>
      {sent ? (
        <div className="flex flex-col items-center gap-4 pb-2 text-center">
          <p className="text-sm text-neutral-300">
            {`Thanks — your report was received and will be reviewed. ${firstName} has been blocked and your conversation removed. They won't know it came from you.`}
          </p>
          <button
            onClick={onDone}
            className="rounded-full bg-white px-6 py-3 font-semibold text-black transition hover:bg-neutral-200"
          >
            Done
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 pb-2">
          <p className="text-xs text-neutral-500">
            Confidential — never shown to {firstName}.
          </p>
          {REPORT_REASONS.map((r) => (
            <button
              key={r.key}
              onClick={() => setReason(r.key)}
              className={`rounded-xl border px-4 py-3 text-left text-sm transition ${
                reason === r.key
                  ? "border-red-500 bg-red-500/10 text-red-300"
                  : "border-neutral-700 text-neutral-300 hover:border-neutral-500"
              }`}
            >
              {r.label}
            </button>
          ))}
          <textarea
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            rows={2}
            placeholder="Anything else we should know? (optional)"
            className="resize-none rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm outline-none focus:border-neutral-400"
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            onClick={submit}
            disabled={busy}
            className="rounded-full bg-red-500 px-6 py-3 font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
          >
            {busy ? "Sending…" : "Send report"}
          </button>
        </div>
      )}
    </Sheet>
  );
}
