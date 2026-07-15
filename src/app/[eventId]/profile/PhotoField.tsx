"use client";

import { useRef, useState } from "react";

export default function PhotoField({
  defaultUrl,
}: {
  defaultUrl?: string | null;
}) {
  const [url, setUrl] = useState(defaultUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
      setUrl(json.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <span className="text-neutral-300">
        Photo <span className="text-neutral-500">(optional)</span>
      </span>
      <input type="hidden" name="photo_url" value={url} />
      <div className="flex items-center gap-4">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-indigo-800 to-fuchsia-800">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="Your photo" className="h-full w-full object-cover" />
          ) : (
            <span className="text-2xl">📷</span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="w-fit rounded-full border border-neutral-600 px-4 py-2 font-medium transition hover:border-neutral-300 disabled:opacity-50"
          >
            {busy ? "Uploading…" : url ? "Change photo" : "Upload photo"}
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
