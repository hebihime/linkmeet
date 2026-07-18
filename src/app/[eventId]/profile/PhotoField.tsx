"use client";

import { useRef, useState } from "react";

const MAX_PHOTOS = 6;

// Multi-photo editor. photos[0] is the cover (what the deck card shows);
// tapping any other photo promotes it to cover. The form receives the whole
// gallery as one JSON hidden input.
export default function PhotoField({
  defaultPhotos,
}: {
  defaultPhotos?: string[] | null;
}) {
  const [photos, setPhotos] = useState<string[]>(defaultPhotos ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-picking the same file later
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const room = MAX_PHOTOS - photos.length;
      const uploaded: string[] = [];
      for (const file of files.slice(0, room)) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Upload failed");
        uploaded.push(json.url);
      }
      setPhotos((p) => [...p, ...uploaded].slice(0, MAX_PHOTOS));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  function makeCover(i: number) {
    if (i === 0) return;
    setPhotos((p) => [p[i], ...p.filter((_, j) => j !== i)]);
  }

  function remove(i: number) {
    setPhotos((p) => p.filter((_, j) => j !== i));
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <span className="text-neutral-300">
        Photos{" "}
        <span className="text-neutral-500">
          (up to {MAX_PHOTOS} — tap one to make it your cover)
        </span>
      </span>
      <input type="hidden" name="photos" value={JSON.stringify(photos)} />
      <div className="grid grid-cols-3 gap-2">
        {photos.map((url, i) => (
          <div
            key={url}
            className="relative aspect-[3/4] overflow-hidden rounded-xl"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={i === 0 ? "Cover photo" : `Photo ${i + 1}`}
              onClick={() => makeCover(i)}
              className="h-full w-full cursor-pointer object-cover"
            />
            {i === 0 && (
              <span className="absolute bottom-1 left-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
                Cover
              </span>
            )}
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label={`Remove photo ${i + 1}`}
              className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition hover:bg-black/80"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-3.5 w-3.5">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        ))}
        {photos.length < MAX_PHOTOS && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            aria-label="Add photos"
            className="flex aspect-[3/4] items-center justify-center rounded-xl border border-dashed border-neutral-700 text-2xl text-neutral-500 transition hover:border-neutral-400 hover:text-neutral-300 disabled:opacity-50"
          >
            {busy ? "…" : "+"}
          </button>
        )}
      </div>
      {error && <span className="text-xs text-red-400">{error}</span>}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        onChange={onFiles}
        className="hidden"
      />
    </div>
  );
}
