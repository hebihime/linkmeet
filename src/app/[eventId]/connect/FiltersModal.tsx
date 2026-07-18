"use client";

import { useState } from "react";
import {
  DEFAULT_FILTERS,
  type DeckFilters,
  type ShowMe,
} from "@/lib/filters";

// Full-screen deck filter settings, opened from the hamburger. Edits a local
// draft; nothing hits the deck until Apply.
export default function FiltersModal({
  filters,
  availableTags,
  onApply,
  onClose,
}: {
  filters: DeckFilters;
  availableTags: string[];
  onApply: (f: DeckFilters) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<DeckFilters>(filters);
  const set = (patch: Partial<DeckFilters>) =>
    setDraft((d) => ({ ...d, ...patch }));

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-neutral-950">
      <div className="flex h-full w-full max-w-md flex-col">
        <header className="flex items-center justify-between px-5 pb-3 pt-6">
          <button
            onClick={onClose}
            aria-label="Close filters"
            className="flex h-9 w-9 items-center justify-center rounded-full text-neutral-400 transition hover:text-white"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          <h2 className="text-lg font-bold">Deck filters</h2>
          <button
            onClick={() => setDraft(DEFAULT_FILTERS)}
            className="text-sm text-neutral-400 transition hover:text-white"
          >
            Reset
          </button>
        </header>

        <div className="flex flex-1 flex-col gap-7 overflow-y-auto px-5 pb-6 pt-2">
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-neutral-500">
              Interests
            </h3>
            {availableTags.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {availableTags.map((tag) => {
                  const on = draft.tags.includes(tag);
                  return (
                    <button
                      key={tag}
                      onClick={() =>
                        set({
                          tags: on
                            ? draft.tags.filter((t) => t !== tag)
                            : [...draft.tags, tag],
                        })
                      }
                      className={`rounded-full px-3.5 py-1.5 text-sm transition ${
                        on
                          ? "bg-fuchsia-500 font-semibold text-white"
                          : "bg-white/10 text-neutral-300 hover:bg-white/20"
                      }`}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-neutral-500">No tags at this event yet.</p>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <Toggle
              label="Attending solo only"
              checked={draft.soloOnly}
              onChange={(v) => set({ soloOnly: v })}
            />
            <Toggle
              label="Has a photo"
              checked={draft.hasPhoto}
              onChange={(v) => set({ hasPhoto: v })}
            />
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-neutral-500">
              Age
            </h3>
            <div className="flex items-center gap-3">
              <input
                type="number"
                inputMode="numeric"
                min={18}
                max={99}
                placeholder="Min"
                value={draft.ageMin ?? ""}
                onChange={(e) =>
                  set({ ageMin: e.target.value ? Number(e.target.value) : null })
                }
                className="w-24 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2.5 outline-none focus:border-neutral-400"
              />
              <span className="text-neutral-500">to</span>
              <input
                type="number"
                inputMode="numeric"
                min={18}
                max={99}
                placeholder="Max"
                value={draft.ageMax ?? ""}
                onChange={(e) =>
                  set({ ageMax: e.target.value ? Number(e.target.value) : null })
                }
                className="w-24 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2.5 outline-none focus:border-neutral-400"
              />
            </div>
            {(draft.ageMin != null || draft.ageMax != null) && (
              <Toggle
                label="Include people who didn't share their age"
                checked={draft.ageUnspecified}
                onChange={(v) => set({ ageUnspecified: v })}
              />
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-neutral-500">
              Show me
            </h3>
            <div className="flex gap-2">
              {(["everyone", "men", "women"] as ShowMe[]).map((v) => (
                <button
                  key={v}
                  onClick={() => set({ showMe: v })}
                  className={`flex-1 rounded-xl px-3 py-2.5 text-sm capitalize transition ${
                    draft.showMe === v
                      ? "bg-white font-semibold text-black"
                      : "bg-white/10 text-neutral-300 hover:bg-white/20"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
            {draft.showMe !== "everyone" && (
              <Toggle
                label="Include people who didn't share their gender"
                checked={draft.genderUnspecified}
                onChange={(v) => set({ genderUnspecified: v })}
              />
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-neutral-500">
              Company
            </h3>
            <input
              value={draft.company}
              onChange={(e) => set({ company: e.target.value })}
              placeholder="e.g. Stripe"
              className="rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 outline-none focus:border-neutral-400"
            />
            {draft.company.trim() !== "" && (
              <Toggle
                label="Include people who didn't share their company"
                checked={draft.companyUnspecified}
                onChange={(v) => set({ companyUnspecified: v })}
              />
            )}
          </section>
        </div>

        <div className="border-t border-neutral-800 px-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] pt-4">
          <button
            onClick={() => onApply(draft)}
            className="w-full rounded-full bg-white px-6 py-3 font-semibold text-black transition hover:bg-neutral-200"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm text-neutral-300">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 accent-fuchsia-500"
      />
    </label>
  );
}
