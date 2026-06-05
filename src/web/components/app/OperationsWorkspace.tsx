import { ControlsPanel } from "@/web/components/app/ControlsPanel";
import { GoalDocumentPanel } from "@/web/components/app/GoalDocumentPanel";
import { LogsSummaryPanel } from "@/web/components/app/LogsSummaryPanel";
import type { RuntimeStreamState } from "@/web/events/runtimeStream";
import type { RepositorySelectionState } from "@/web/repository/repositorySelection";
import type { RunnerStatus } from "@/web/runner/statuses";

export function OperationsWorkspace({
  goalRefreshToken,
  onRepositorySelected,
  onRunnerStatusChange,
  repositorySelection,
  runnerStatus,
  runtimeStream,
}: {
  goalRefreshToken: number;
  onRepositorySelected: (repositoryPath: string) => void;
  onRunnerStatusChange: (status: RunnerStatus) => void;
  repositorySelection: RepositorySelectionState;
  runnerStatus: RunnerStatus;
  runtimeStream: RuntimeStreamState;
}) {
  return (
    <div className="grid h-full min-h-0 w-full grid-rows-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.85fr)] gap-3 overflow-hidden sm:gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,20rem)] lg:grid-rows-[minmax(0,1fr)_minmax(0,0.42fr)]">
      <div className="min-h-0 min-w-0 overflow-hidden lg:col-start-1 lg:row-start-1">
        <GoalDocumentPanel
          goalRefreshToken={goalRefreshToken}
          repositorySelection={repositorySelection}
        />
      </div>
      <aside className="min-h-0 min-w-0 overflow-hidden lg:col-start-2 lg:row-start-1">
        <ControlsPanel
          onRepositorySelected={onRepositorySelected}
          onRunnerStatusChange={onRunnerStatusChange}
          repositorySelection={repositorySelection}
          runnerStatus={runnerStatus}
        />
      </aside>
      <div className="min-h-0 min-w-0 overflow-hidden lg:col-span-2 lg:row-start-2">
        <LogsSummaryPanel
          runnerStatus={runnerStatus}
          runtimeStream={runtimeStream}
        />
      </div>
    </div>
  );
}
