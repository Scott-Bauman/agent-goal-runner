import {
  ControlsPanel,
  RUN_SETUP_SECTIONS,
} from "@/web/components/app/ControlsPanel";
import { GoalDocumentPanel } from "@/web/components/app/GoalDocumentPanel";
import { LogsSummaryPanel } from "@/web/components/app/LogsSummaryPanel";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/web/components/ui/sidebar";
import type { RuntimeStreamState } from "@/web/events/runtimeStream";
import type { RepositorySelectionState } from "@/web/repository/repositorySelection";
import type { RunnerStatus } from "@/web/runner/statuses";

function CollapsedSetupNav() {
  const { setOpen, state } = useSidebar();
  const isCollapsed = state === "collapsed";

  function handleSectionSelect(sectionId: string) {
    setOpen(true);
    window.requestAnimationFrame(() => {
      document.getElementById(sectionId)?.scrollIntoView({
        block: "start",
      });
    });
  }

  return (
    <SidebarGroup
      aria-hidden={!isCollapsed}
      className="h-0 overflow-hidden p-0 opacity-0 transition-[height,opacity,padding] duration-200 ease-linear group-data-[collapsible=icon]:h-auto group-data-[collapsible=icon]:p-2 group-data-[collapsible=icon]:opacity-100"
      inert={!isCollapsed}
    >
      <SidebarMenu>
        {RUN_SETUP_SECTIONS.map((section) => (
          <SidebarMenuItem key={section.id}>
            <SidebarMenuButton
              aria-label={section.title}
              tooltip={section.title}
              onClick={() => {
                handleSectionSelect(section.id);
              }}
            >
              <section.icon />
              <span>{section.title}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}

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
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  return (
    <>
      <Sidebar
        className="top-16 h-[calc(100svh-4rem)]"
        collapsible="icon"
      >
        <SidebarHeader className="h-14 justify-center border-b">
          <div className="flex items-center justify-between gap-2">
            <div className="w-28 min-w-0 overflow-hidden px-1 opacity-100 transition-[width,opacity,padding,transform] duration-200 ease-linear group-data-[collapsible=icon]:w-0 group-data-[collapsible=icon]:-translate-x-1 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:opacity-0">
              <h2 className="truncate text-sm font-semibold text-sidebar-foreground">
                Run setup
              </h2>
            </div>
            <SidebarTrigger className="shrink-0" />
          </div>
        </SidebarHeader>
        <SidebarContent>
          <CollapsedSetupNav />
          <SidebarGroup
            aria-hidden={isCollapsed}
            className="min-h-0 flex-1 transition-[opacity,transform] duration-200 ease-linear group-data-[collapsible=icon]:pointer-events-none group-data-[collapsible=icon]:-translate-x-2 group-data-[collapsible=icon]:opacity-0"
            inert={isCollapsed}
          >
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
