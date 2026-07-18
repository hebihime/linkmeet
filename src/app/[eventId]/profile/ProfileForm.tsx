"use client";

import { useActionState } from "react";
import { saveProfile } from "@/lib/actions";
import type { Profile } from "@/lib/queries";
import PhotoField from "./PhotoField";

// Latest selectable DOB — someone whose 18th birthday is today just makes it.
function eighteenYearsAgo(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 18);
  return d.toISOString().slice(0, 10);
}

export default function ProfileForm({ existing }: { existing?: Profile }) {
  const [state, formAction, pending] = useActionState(saveProfile, null);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <label className="flex flex-col gap-2 text-sm">
        <span className="text-neutral-300">Name</span>
        <input
          name="name"
          required
          defaultValue={existing?.name ?? ""}
          placeholder="Ada Lovelace"
          className="rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 outline-none focus:border-neutral-400"
        />
      </label>

      <label className="flex flex-col gap-2 text-sm">
        <span className="text-neutral-300">
          Headline <span className="text-neutral-500">(optional)</span>
        </span>
        <input
          name="headline"
          defaultValue={existing?.headline ?? ""}
          placeholder="Founder · here to meet other builders"
          className="rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 outline-none focus:border-neutral-400"
        />
      </label>

      <label className="flex flex-col gap-2 text-sm">
        <span className="text-neutral-300">
          Interest tags{" "}
          <span className="text-neutral-500">(comma-separated, up to 8)</span>
        </span>
        <input
          name="tags"
          defaultValue={existing?.tags?.join(", ") ?? ""}
          placeholder="AI, climbing, jazz, medtech"
          className="rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 outline-none focus:border-neutral-400"
        />
      </label>

      <PhotoField
        defaultPhotos={
          existing?.photos?.length
            ? existing.photos
            : existing?.photo_url
              ? [existing.photo_url]
              : []
        }
      />

      <label className="flex flex-col gap-2 text-sm">
        <span className="text-neutral-300">Date of birth</span>
        <input
          name="birth_date"
          type="date"
          required
          max={eighteenYearsAgo()}
          defaultValue={existing?.birth_date ?? ""}
          className="rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 outline-none [color-scheme:dark] focus:border-neutral-400"
        />
        <span className="text-xs text-neutral-500">
          Never shown to anyone — only used to confirm you&apos;re 18+ and for
          age-range filters.
        </span>
      </label>

      <label className="flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-3 text-sm">
        <input
          type="checkbox"
          name="adult"
          required
          className="h-4 w-4 accent-fuchsia-500"
        />
        <span className="text-neutral-300">
          I confirm I&apos;m 18 or older
          <span className="block text-xs text-neutral-500">
            LinkMeet is for adults only.
          </span>
        </span>
      </label>

      <label className="flex flex-col gap-2 text-sm">
        <span className="text-neutral-300">
          Company <span className="text-neutral-500">(optional)</span>
        </span>
        <input
          name="company"
          defaultValue={existing?.company ?? ""}
          placeholder="Acme Robotics"
          className="rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 outline-none focus:border-neutral-400"
        />
      </label>

      <label className="flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-3 text-sm">
        <input
          type="checkbox"
          name="solo"
          defaultChecked={existing?.solo ?? false}
          className="h-4 w-4 accent-fuchsia-500"
        />
        <span className="text-neutral-300">
          I&apos;m attending solo
          <span className="block text-xs text-neutral-500">
            Helps you find others who came alone too.
          </span>
        </span>
      </label>

      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-white px-6 py-3 font-semibold text-black transition hover:bg-neutral-200 disabled:opacity-60"
      >
        {pending ? "Saving…" : existing ? "Save" : "Continue"}
      </button>
    </form>
  );
}
