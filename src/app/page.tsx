import Link from "next/link";

const POINTS = [
  {
    title: "Swipe to signal",
    body: "Meet, Link, or Invite the people around you — no walking up cold.",
  },
  {
    title: "Rejection-safe",
    body: "Requests are async and declines are silent. Nobody ever sees a no.",
  },
  {
    title: "For this event only",
    body: "Everything expires with the con. No follower counts, no baggage.",
  },
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-6 py-12">
      <div className="text-center">
        <h1 className="bg-gradient-to-r from-indigo-400 to-fuchsia-400 bg-clip-text text-5xl font-bold tracking-tight text-transparent">
          LinkMeet
        </h1>
        <p className="mt-3 text-lg text-neutral-300">
          Meet the people worth meeting at your convention.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {POINTS.map((p) => (
          <div
            key={p.title}
            className="rounded-2xl border border-neutral-800 bg-neutral-900 px-5 py-4"
          >
            <h2 className="font-semibold">{p.title}</h2>
            <p className="mt-0.5 text-sm text-neutral-400">{p.body}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col items-center gap-3">
        <Link
          href="/new"
          className="rounded-full bg-white px-8 py-3.5 font-semibold text-black transition hover:bg-neutral-200"
        >
          Create an event
        </Link>
        <p className="text-sm text-neutral-500">
          Attending one? Open your event&apos;s link and enter your code.
        </p>
      </div>
    </main>
  );
}
