import { RunnerStatusBadge } from "@/web/components/app/RunnerStatusBadge";
import { Badge } from "@/web/components/ui/badge";
import StatusIndicator from "@/web/components/ui/status-indicator";
import {
  connectionStatusConfig,
  formatProgress,
  type RuntimeStreamState,
} from "@/web/events/runtimeStream";
import {
  getRepositoryLabel,
  type RepositorySelectionState,
} from "@/web/repository/repositorySelection";
import type { RunnerStatus } from "@/web/runner/statuses";

const connectionIndicatorState: Record<
  RuntimeStreamState["connectionStatus"],
  "active" | "down" | "fixing"
> = {
  connecting: "fixing",
  error: "down",
  open: "active",
};

export function TopBar({
  actionSlotId,
  repositorySelection,
  runtimeStream,
  status,
}: {
  actionSlotId: string;
  repositorySelection: RepositorySelectionState;
  runtimeStream: RuntimeStreamState;
  status: RunnerStatus;
}) {
  const selectedRepositoryFullLabel = getRepositoryLabel(repositorySelection);
  const selectedRepositoryLabel = getRepositoryFolderLabel(repositorySelection);
  const connectionConfig =
    connectionStatusConfig[runtimeStream.connectionStatus];
  const changedFiles = runtimeStream.runDetails.changedFiles;
  const changedFilesLabel =
    changedFiles.length > 0 ? changedFiles.slice(0, 2).join(", ") : "None";
  const latestSummaryLabel =
    runtimeStream.latestSummary?.message ?? "No run summary yet";
  const progressLabel = formatProgress(runtimeStream.progress);

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center border-b border-zinc-200 bg-white">
      <div className="flex min-w-0 flex-1 items-center gap-4 px-4">
        <div className="min-w-0 shrink-0 sm:w-80">
          <h1 className="truncate text-base font-semibold leading-6 text-zinc-950">
            Agent Goal Runner
          </h1>
          <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-zinc-500">
            <span className="shrink-0 font-semibold text-zinc-700">
              {selectedRepositoryLabel}
            </span>
            <span
              className="hidden min-w-0 truncate font-mono text-zinc-500 sm:block"
              title={selectedRepositoryFullLabel}
            >
              {selectedRepositoryFullLabel}
            </span>
          </div>
        </div>

        <div className="hidden min-w-0 flex-1 items-center justify-end gap-3 lg:flex">
          <dl className="grid max-w-xl grid-cols-3 gap-3 rounded-lg border bg-zinc-50 px-3 py-2 text-xs">
            <div className="min-w-0">
              <dt className="font-medium text-zinc-500">Status</dt>
              <dd className="mt-0.5">
                <RunnerStatusBadge status={status} />
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="font-medium text-zinc-500">Progress</dt>
              <dd
                className="mt-1 truncate font-semibold text-zinc-800"
                title={latestSummaryLabel}
              >
                {progressLabel}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="font-medium text-zinc-500">Changed</dt>
              <dd
                className="mt-1 truncate font-semibold text-zinc-800"
                title={changedFilesLabel}
              >
                {changedFilesLabel}
              </dd>
            </div>
          </dl>
          <Badge
            className="h-8 w-fit shrink-0 gap-1.5 rounded-full px-3"
            variant={connectionConfig.variant}
          >
            <StatusIndicator
              className="gap-0"
              size="sm"
              state={connectionIndicatorState[runtimeStream.connectionStatus]}
            />
            {connectionConfig.label}
          </Badge>
        </div>

        <div
          className="ml-auto flex min-w-0 shrink-0 items-center gap-2"
          id={actionSlotId}
        />
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
