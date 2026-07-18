// Instant paint while the requests inbox loads.
export default function RequestsLoading() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-6 pb-28 pt-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Requests</h1>
        <p className="mt-1 text-sm text-neutral-400">
          People who want to connect with you. Declining is silent — they
          never find out.
        </p>
      </header>
      <div className="flex animate-pulse flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 rounded-2xl border border-neutral-800 bg-neutral-900" />
        ))}
      </div>
    </main>
  );
}
