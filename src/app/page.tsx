import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-5xl font-bold tracking-tight">LinkMeet</h1>
      <p className="text-lg text-neutral-400">
        Meet the people worth meeting at your event.
      </p>
      <Link
        href="/new"
        className="rounded-full bg-white px-6 py-3 font-semibold text-black transition hover:bg-neutral-200"
      >
        Create an event
      </Link>
      <p className="text-sm text-neutral-500">
        Got a code? Open your event&apos;s link and enter it.
      </p>
    </main>
  );
}
