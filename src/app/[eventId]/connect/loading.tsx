// Instant paint while the deck's first hand is dealt.
export default function ConnectLoading() {
  return (
    <main className="mx-auto flex h-dvh w-full max-w-md flex-col px-5 pb-24 pt-4">
      <header className="mb-3 flex items-center">
        <div className="h-10 w-10 animate-pulse rounded-full bg-neutral-900" />
      </header>
      <div className="min-h-0 flex-1 animate-pulse rounded-3xl border border-neutral-800 bg-neutral-900" />
    </main>
  );
}
