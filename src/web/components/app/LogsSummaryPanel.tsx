import { Activity, Terminal } from "lucide-react";

import { Badge } from "@/web/components/ui/badge";
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
  formatLogStream,
  formatProgress,
  type RuntimeStreamState,
} from "@/web/events/runtimeStream";
import {
  statusBadgeConfig,
  type RunnerStatus,
} from "@/web/runner/statuses";

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
            className="h-6 w-fit shrink-0"
            variant={connectionConfig.variant}
          >
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
          <div
            aria-live="polite"
            className="min-h-0 flex-1 overflow-auto bg-zinc-950 px-4 py-3"
          >
            {runtimeStream.logs.length > 0 ? (
              <ol className="grid gap-2">
                {runtimeStream.logs.map((entry) => (
                  <li
                    className="grid min-w-0 gap-1 font-mono text-xs leading-5 text-zinc-100 sm:grid-cols-[4.5rem_minmax(0,1fr)]"
                    key={entry.id}
                  >
                    <span
                      className={
                        entry.stream === "stderr"
                          ? "font-semibold text-red-300"
                          : entry.stream === "stdout"
                            ? "font-semibold text-emerald-300"
                            : "font-semibold text-sky-300"
                      }
                    >
                      {formatLogStream(entry.stream)}
                    </span>
                    <span className="min-w-0 whitespace-pre-wrap break-words text-zinc-200">
                      {entry.message}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="flex min-h-full items-center justify-center py-5">
                <p className="max-w-sm text-center font-mono text-xs leading-5 text-zinc-400">
                  Run output will stream here when a Codex loop starts.
                </p>
              </div>
            )}
          </div>
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
