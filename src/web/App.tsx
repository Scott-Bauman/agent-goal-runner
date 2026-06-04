export function App() {
  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-8 text-zinc-950">
      <section className="mx-auto flex max-w-5xl items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">codex-goal-runner</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Local goal runner operations panel
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 items-center rounded-md border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-700">
            Idle
          </span>
          <button
            className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-zinc-950 bg-zinc-950 px-3 text-xs font-medium text-white transition-colors hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
          >
            Select repository
          </button>
        </div>
      </section>
    </main>
  );
}
