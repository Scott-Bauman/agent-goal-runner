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

function formatSkillPreflight(details: RunSummaryDetails): string {
  if (!details.skillPreflight.checked) {
    return "Not checked";
  }

  if (details.skillPreflight.missing.length > 0) {
    return `Missing ${details.skillPreflight.missing.map((skill) => `$${skill}`).join(", ")}`;
  }

  return details.skillPreflight.found.length > 0
    ? `Found ${details.skillPreflight.found.map((skill) => `$${skill}`).join(", ")}`
    : "No skill references";
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
      <dt className="text-[0.6875rem] font-medium uppercase tracking-normal text-zinc-500">
        {label}
      </dt>
      <dd
        className="mt-1 truncate text-xs font-semibold text-zinc-900"
        title={title ?? value}
      >
        {value}
      </dd>
    </div>
  );
}

function RunSummary({ details }: { details: RunSummaryDetails }) {
  const changedFiles =
    details.changedFiles.length > 0
      ? details.changedFiles.slice(0, 3).join(", ")
      : "None";

  return (
    <div className="border-b bg-zinc-50 px-4 py-3">
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="min-w-0">
          <dt className="text-[0.6875rem] font-medium uppercase tracking-normal text-zinc-500">
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
        <SummaryItem
          label="Tokens"
          value={formatNullable(details.tokenCount)}
        />
        <SummaryItem
          label="Changed"
          title={details.changedFiles.join(", ") || "None"}
          value={changedFiles}
        />
        <SummaryItem
          label="Warnings"
          value={String(details.warningCount)}
        />
        <SummaryItem
          label="Errors"
          value={String(details.errorCount)}
        />
        <SummaryItem
          label="Stop"
          value={details.stopReason ?? "None"}
        />
        <SummaryItem
          label="Skill"
          value={formatSkillPreflight(details)}
        />
      </dl>
      {details.lastAssistantMessage ? (
        <div className="mt-3 rounded-md border border-zinc-200 bg-white px-3 py-2">
          <p className="text-[0.6875rem] font-medium uppercase tracking-normal text-zinc-500">
            Final assistant
          </p>
          <p className="mt-1 max-h-16 overflow-hidden whitespace-pre-wrap text-xs leading-5 text-zinc-800">
            {details.lastAssistantMessage}
          </p>
        </div>
      ) : null}
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
            Codex output
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
