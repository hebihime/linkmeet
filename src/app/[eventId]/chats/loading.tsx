// Instant paint while the chat list loads.
export default function ChatsLoading() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-6 pb-28 pt-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Chats</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Your connections at this event.
        </p>
      </header>
      <div className="flex animate-pulse flex-col gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex items-center gap-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-4"
          >
            <div className="h-14 w-14 shrink-0 rounded-full bg-neutral-800" />
            <div className="flex-1">
              <div className="h-4 w-28 rounded bg-neutral-800" />
              <div className="mt-2 h-3 w-40 rounded bg-neutral-800" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
