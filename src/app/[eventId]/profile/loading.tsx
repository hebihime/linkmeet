// Instant paint while the profile form loads.
export default function ProfileLoading() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-5 px-6 py-10 pb-28">
      <div className="h-9 w-56 animate-pulse rounded-lg bg-neutral-900" />
      <div className="h-4 w-72 animate-pulse rounded bg-neutral-900" />
      <div className="flex animate-pulse flex-col gap-5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-2">
            <div className="h-4 w-20 rounded bg-neutral-900" />
            <div className="h-12 rounded-lg bg-neutral-900" />
          </div>
        ))}
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="aspect-[3/4] rounded-xl bg-neutral-900" />
          ))}
        </div>
      </div>
    </main>
  );
}
