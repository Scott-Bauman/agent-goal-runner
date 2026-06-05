import { RunnerStatusBadge } from "@/web/components/app/RunnerStatusBadge";
import {
  getRepositoryLabel,
  type RepositorySelectionState,
} from "@/web/repository/repositorySelection";
import type { RunnerStatus } from "@/web/runner/statuses";

export function TopBar({
  repositorySelection,
  status,
}: {
  repositorySelection: RepositorySelectionState;
  status: RunnerStatus;
}) {
  const selectedRepositoryLabel = getRepositoryLabel(repositorySelection);

  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex min-h-16 max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="min-w-0">
          <h1 className="text-base font-semibold leading-6 text-zinc-950">
            codex-goal-runner
          </h1>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-zinc-500">
            <span className="shrink-0 font-medium text-zinc-600">Repository</span>
            <span
              className="min-w-0 truncate font-mono text-zinc-700"
              title={selectedRepositoryLabel}
            >
              {selectedRepositoryLabel}
            </span>
          </div>
        </div>
        <RunnerStatusBadge status={status} />
      </div>
    </header>
  );
}
