import { Activity, Terminal } from "lucide-react";

import { Badge } from "@/web/components/ui/badge";
import StatusIndicator from "@/web/components/ui/status-indicator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/web/components/ui/card";
import { RunnerStatusBadge } from "@/web/components/app/RunnerStatusBadge";
import {
  connectionStatusConfig,
  formatProgress,
  type RuntimeStreamState,
} from "@/web/events/runtimeStream";
import { LogConsole } from "@/web/components/app/LogConsole";
import {
  statusBadgeConfig,
  type RunnerStatus,
} from "@/web/runner/statuses";

const connectionIndicatorState: Record<
  RuntimeStreamState["connectionStatus"],
  "active" | "down" | "fixing"
> = {
  connecting: "fixing",
  error: "down",
  open: "active",
};

export function LogsSummaryPanel({
  runnerStatus,
  runtimeStream,
}: {
  runnerStatus: RunnerStatus;
  runtimeStream: RuntimeStreamState;
}) {
  const connectionConfig =
    connectionStatusConfig[runtimeStream.connectionStatus];
  const latestSummary = runtimeStream.latestSummary;
  const progressLabel = formatProgress(runtimeStream.progress);

  return (
    <Card
      aria-labelledby="logs-summary-title"
      role="region"
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg"
    >
      <CardHeader className="flex min-h-14 flex-row flex-wrap items-center justify-between gap-2 border-b px-4 py-3 sm:flex-nowrap sm:py-0">
        <div className="flex min-w-0 items-center gap-2">
          <Terminal
            aria-hidden="true"
            className="h-4 w-4 shrink-0 text-muted-foreground"
            strokeWidth={2}
          />
          <CardTitle
            id="logs-summary-title"
            className="truncate text-sm"
          >
            Logs
          </CardTitle>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <CardDescription className="hidden min-w-0 max-w-[55%] truncate text-right text-xs font-medium sm:block sm:max-w-none">
            {progressLabel}
          </CardDescription>
          <Badge
            className="h-6 w-fit shrink-0 gap-1.5"
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
      </CardHeader>
      <CardContent className="grid min-h-0 flex-1 gap-0 overflow-hidden p-0 md:grid-cols-[minmax(0,1fr)_18rem]">
        <section
          aria-labelledby="live-logs-title"
          className="flex min-h-0 min-w-0 flex-col border-b md:border-b-0 md:border-r"
        >
          <div className="flex h-11 items-center gap-2 border-b px-4">
            <Terminal
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-muted-foreground"
              strokeWidth={2}
            />
            <h2
              id="live-logs-title"
              className="truncate text-xs font-medium text-zinc-700"
            >
              Live logs
            </h2>
          </div>
          <LogConsole logs={runtimeStream.logs} />
        </section>

        <section
          aria-labelledby="latest-summary-title"
          className="flex min-h-0 min-w-0 flex-col"
        >
          <div className="flex h-11 items-center gap-2 border-b px-4">
            <Activity
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-muted-foreground"
              strokeWidth={2}
            />
            <h2
              id="latest-summary-title"
              className="truncate text-xs font-medium text-zinc-700"
            >
              Latest summary
            </h2>
          </div>
          <dl className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto px-4 py-4 text-xs">
            <div className="grid gap-1">
              <dt className="font-medium text-zinc-500">Status</dt>
              <dd>
                <RunnerStatusBadge status={runnerStatus} />
              </dd>
            </div>
            <div className="grid gap-1">
              <dt className="font-medium text-zinc-500">Progress</dt>
              <dd className="text-sm font-medium text-zinc-800">
                {progressLabel}
              </dd>
            </div>
            <div className="grid gap-1">
              <dt className="font-medium text-zinc-500">Last event</dt>
              <dd className="leading-5 text-muted-foreground">
                {latestSummary?.message ??
                  "Run summaries will appear here after backend events are received."}
              </dd>
            </div>
            {latestSummary ? (
              <div className="grid gap-1">
                <dt className="font-medium text-zinc-500">Event status</dt>
                <dd className="text-sm font-medium text-zinc-800">
                  {statusBadgeConfig[latestSummary.status].label}
                </dd>
              </div>
            ) : null}
          </dl>
        </section>
      </CardContent>
    </Card>
  );
}
