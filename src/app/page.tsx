import { listEvents } from "@/lib/queries";
import EventFinder from "./EventFinder";

// The consumer story is two steps: find your event's link, then swipe to
// meet. Creating events is an organizer job — kept out of the way (footer).
export const dynamic = "force-dynamic"; // the carousel must show new events immediately

export default async function Home() {
  const events = await listEvents();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-10 px-6 py-12">
      <div className="text-center">
        <h1 className="bg-gradient-to-r from-indigo-400 to-fuchsia-400 bg-clip-text text-5xl font-bold tracking-tight text-transparent">
          LinkMeet
        </h1>
        <p className="mt-2 text-lg text-neutral-300">
          Quick connections for conventions
        </p>
        <p className="mt-4 text-sm text-neutral-600">
          Organizing an event?{" "}
          <a href="/new" className="text-neutral-500 underline-offset-2 hover:text-neutral-300 hover:underline">
            Create your link →
          </a>
        </p>
      </div>

      <EventFinder events={events} />
    </main>
  );
}
