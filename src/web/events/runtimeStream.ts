import type { BadgeVariant, RunnerStatus } from "@/web/runner/statuses";

export type GoalChangedEvent = {
  repositoryPath: string;
  goalPath: string;
  exists: boolean;
};

export type StatusEvent = {
  status: RunnerStatus;
  selectedRepositoryPath: string | null;
};

export type LogEntry = {
  id: number;
  stream: "system" | "stdout" | "stderr";
  message: string;
};

export type LogsEvent = {
  entries: LogEntry[];
};

export type RunProgressEvent = {
  currentRun: number;
  totalRuns: number | null;
};

export type RunSummaryEvent = {
  status: RunnerStatus;
  message: string;
} | null;

export type RuntimeStreamState = {
  connectionStatus: "connecting" | "open" | "error";
  logs: LogEntry[];
  progress: RunProgressEvent;
  latestSummary: RunSummaryEvent;
};

export const INITIAL_RUNTIME_STREAM_STATE: RuntimeStreamState = {
  connectionStatus: "connecting",
  logs: [],
  progress: {
    currentRun: 0,
    totalRuns: null,
  },
  latestSummary: null,
};

export const connectionStatusConfig: Record<
  RuntimeStreamState["connectionStatus"],
  {
    label: string;
    variant: BadgeVariant;
  }
> = {
  connecting: {
    label: "Connecting",
    variant: "outline",
  },
  open: {
    label: "Stream open",
    variant: "secondary",
  },
  error: {
    label: "Stream error",
    variant: "destructive",
  },
};

export function parseSseData<T>(event: MessageEvent<string>): T | null {
  try {
    return JSON.parse(event.data) as T;
  } catch {
    return null;
  }
}

export function formatProgress(progress: RunProgressEvent): string {
  if (progress.totalRuns === null) {
    return progress.currentRun > 0 ? `Run ${progress.currentRun}` : "No active run";
  }

  if (progress.totalRuns <= 0 || progress.currentRun <= 0) {
    return "No active run";
  }

  return `Run ${progress.currentRun} of ${progress.totalRuns}`;
}

export function formatLogStream(stream: LogEntry["stream"]): string {
  switch (stream) {
    case "stderr":
      return "stderr";
    case "stdout":
      return "stdout";
    case "system":
      return "system";
  }
}
