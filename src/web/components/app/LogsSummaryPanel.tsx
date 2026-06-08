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
  type RuntimeStreamState,
} from "@/web/events/runtimeStream";
import { LogConsole } from "@/web/components/app/LogConsole";
import type { RunnerStatus } from "@/web/runner/statuses";

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
      <CardContent className="flex min-h-0 flex-1 overflow-hidden p-0">
        <LogConsole logs={runtimeStream.logs} />
      </CardContent>
    </Card>
  );
}
