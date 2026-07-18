// Instant paint while the Explore stats stream in.
export default function ExploreLoading() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col pb-28">
      <div className="h-64 w-full shrink-0 animate-pulse bg-neutral-900" />
      <div className="flex animate-pulse flex-col gap-8 px-6 pt-6">
        <div>
          <div className="h-12 w-24 rounded-lg bg-neutral-900" />
          <div className="mt-2 h-4 w-48 rounded bg-neutral-900" />
        </div>
        <div className="flex flex-col gap-4">
          <div className="h-3 w-36 rounded bg-neutral-900" />
          <div className="h-5 w-full rounded bg-neutral-900" />
          <div className="h-5 w-full rounded bg-neutral-900" />
          <div className="h-5 w-2/3 rounded bg-neutral-900" />
        </div>
      </div>
    </main>
  );
}
