import { Badge, Button } from "./components/ui";

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
          <Badge>Idle</Badge>
          <Button size="sm">Select repository</Button>
        </div>
      </section>
    </main>
  );
}
