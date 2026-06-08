import { Terminal } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/web/components/ui/card";
import {
  formatProgress,
  type RunSummaryDetails,
  type RuntimeStreamState,
} from "@/web/events/runtimeStream";
import { LogConsole } from "@/web/components/app/LogConsole";
import type { RunnerStatus } from "@/web/runner/statuses";
import { RunnerStatusBadge } from "@/web/components/app/RunnerStatusBadge";

function formatNullable(value: string | number | null): string {
  return value === null ? "Unknown" : String(value);
}

function SummaryItem({
  label,
  title,
  value,
}: {
  label: string;
  title?: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.6875rem] font-medium uppercase tracking-normal text-muted-foreground">
        {label}
      </dt>
      <dd
        className="mt-1 truncate text-xs font-semibold text-foreground"
        title={title ?? value}
      >
        {value}
      </dd>
    </div>
  );
}

function RunSummary({ details }: { details: RunSummaryDetails }) {
  return (
    <div className="border-b bg-muted/40 px-4 py-3">
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="min-w-0">
          <dt className="text-[0.6875rem] font-medium uppercase tracking-normal text-muted-foreground">
            Status
          </dt>
          <dd className="mt-1">
            <RunnerStatusBadge status={details.status} />
          </dd>
        </div>
        <SummaryItem
          label="Run"
          value={formatProgress({
            currentRun: details.currentRun,
            totalRuns: details.totalRuns,
          })}
        />
        <SummaryItem
          label="Model"
          value={formatNullable(details.model)}
        />
        <SummaryItem
          label="Reasoning"
          value={formatNullable(details.reasoningEffort)}
        />
      </dl>
    </div>
  );
}

export function LogsSummaryPanel({
  runtimeStream,
}: {
  runnerStatus: RunnerStatus;
  runtimeStream: RuntimeStreamState;
}) {
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
            Agent Output
          </CardTitle>
        </div>
        <CardDescription className="hidden min-w-0 max-w-[55%] truncate text-right text-xs font-medium sm:block sm:max-w-none">
          {progressLabel}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
        <RunSummary details={runtimeStream.runDetails} />
        <LogConsole
          logs={runtimeStream.logs}
          rawLogs={runtimeStream.rawLogs}
        />
      </CardContent>
    </Card>
  );
}
