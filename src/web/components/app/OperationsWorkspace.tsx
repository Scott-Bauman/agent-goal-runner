import { ControlsPanel } from "@/web/components/app/ControlsPanel";
import { GoalDocumentPanel } from "@/web/components/app/GoalDocumentPanel";
import { LogsSummaryPanel } from "@/web/components/app/LogsSummaryPanel";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarRail,
  SidebarTrigger,
} from "@/web/components/ui/sidebar";
import type { RuntimeStreamState } from "@/web/events/runtimeStream";
import type { RepositorySelectionState } from "@/web/repository/repositorySelection";
import type { RunnerStatus } from "@/web/runner/statuses";

export function OperationsWorkspace({
  commandActionsTargetId,
  goalRefreshToken,
  onRepositorySelected,
  onRunnerStatusChange,
  repositorySelection,
  runnerStatus,
  runtimeStream,
}: {
  commandActionsTargetId: string;
  goalRefreshToken: number;
  onRepositorySelected: (repositoryPath: string) => void;
  onRunnerStatusChange: (status: RunnerStatus) => void;
  repositorySelection: RepositorySelectionState;
  runnerStatus: RunnerStatus;
  runtimeStream: RuntimeStreamState;
}) {
  return (
    <>
      <Sidebar
        className="top-16 h-[calc(100svh-4rem)]"
        collapsible="icon"
      >
        <SidebarHeader className="h-14 justify-center border-b">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 px-1 group-data-[collapsible=icon]:hidden">
              <h2 className="truncate text-sm font-semibold text-sidebar-foreground">
                Run setup
              </h2>
            </div>
            <SidebarTrigger className="shrink-0" />
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup className="min-h-0 flex-1 group-data-[collapsible=icon]:hidden">
            <SidebarGroupContent className="min-h-0 flex-1">
              <ControlsPanel
                commandTargetId={commandActionsTargetId}
                onRepositorySelected={onRepositorySelected}
                onRunnerStatusChange={onRunnerStatusChange}
                repositorySelection={repositorySelection}
                runnerStatus={runnerStatus}
              />
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-h-0 overflow-hidden bg-zinc-50">
        <div className="grid h-full min-h-0 w-full grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-3 overflow-hidden p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
          <div className="min-h-0 min-w-0 overflow-hidden">
            <GoalDocumentPanel
              goalRefreshToken={goalRefreshToken}
              onRunnerStatusChange={onRunnerStatusChange}
              repositorySelection={repositorySelection}
              runnerStatus={runnerStatus}
            />
          </div>
          <div className="min-h-0 min-w-0 overflow-hidden">
            <LogsSummaryPanel
              runnerStatus={runnerStatus}
              runtimeStream={runtimeStream}
            />
          </div>
        </div>
      </SidebarInset>
    </>
  );
}
