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
  const selectedRepositoryFullLabel = getRepositoryLabel(repositorySelection);
  const selectedRepositoryLabel = getRepositoryFolderLabel(repositorySelection);

  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex min-h-16 max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="min-w-0">
          <h1 className="text-base font-semibold leading-6 text-zinc-950">
            Agent Goal Runner
          </h1>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-zinc-500">
            <span className="shrink-0 font-medium text-zinc-600">Repository</span>
            <span
              className="min-w-0 truncate font-mono text-zinc-700"
              title={selectedRepositoryFullLabel}
            >
              {selectedRepositoryLabel}
            </span>
          </div>
        </div>
        <div className="grid justify-items-center gap-1">
          <span className="text-xs font-medium text-zinc-600">Status</span>
          <RunnerStatusBadge
            className="h-7 min-w-15 justify-center px-4 text-sm"
            status={status}
          />
        </div>
      </div>
    </header>
  );
}

function getRepositoryFolderLabel(
  repositorySelection: RepositorySelectionState,
) {
  if (
    repositorySelection.status !== "ready" ||
    repositorySelection.repositoryPath === null
  ) {
    return getRepositoryLabel(repositorySelection);
  }

  return getFolderName(repositorySelection.repositoryPath);
}

function getFolderName(repositoryPath: string) {
  const trimmedPath = repositoryPath.replace(/[\\/]+$/, "");
  const pathParts = trimmedPath.split(/[\\/]/);

  return pathParts[pathParts.length - 1] || repositoryPath;
}
