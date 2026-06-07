import {
  statusBadgeConfig,
  type BadgeVariant,
  type RunnerStatus,
} from "@/web/runner/statuses";

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

export type TranscriptEventKind =
  | "agent"
  | "command"
  | "done"
  | "edit"
  | "error"
  | "git"
  | "verify"
  | "warn";

export type RunProgressEvent = {
  currentRun: number;
  totalRuns: number | null;
};

export type RunSummaryEvent = {
  status: RunnerStatus;
  message: string;
} | null;

type RuntimeTranscriptEntryBase = {
  displayId: string;
  id: string;
  kind: TranscriptEventKind;
  receivedAt: number;
  runIndex: number;
  totalRuns: number | null;
};

export type RuntimeTranscriptLogEntry = RuntimeTranscriptEntryBase & {
  message: string;
  sourceLogId: number;
  stream: LogEntry["stream"];
  type: "log";
};

export type RuntimeTranscriptSeparatorEntry = RuntimeTranscriptEntryBase & {
  message: string;
  separatorKind: "completion" | "run-start" | "summary";
  status?: RunnerStatus;
  type: "separator";
};

export type RuntimeTranscriptEntry =
  | RuntimeTranscriptLogEntry
  | RuntimeTranscriptSeparatorEntry;

export type RuntimeStreamState = {
  connectionStatus: "connecting" | "open" | "error";
  logs: RuntimeTranscriptEntry[];
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
    label: "SSE Connecting",
    variant: "outline",
  },
  open: {
    label: "SSE Stream Open",
    variant: "secondary",
  },
  error: {
    label: "SSE Stream Error",
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

export function classifyTranscriptMessage(message: string): TranscriptEventKind {
  const normalizedMessage = message.toLowerCase();

  if (/\b(error|failed|failure|exception|fatal)\b/.test(normalizedMessage)) {
    return "error";
  }

  if (/\b(warning|warn|deprecated)\b/.test(normalizedMessage)) {
    return "warn";
  }

  if (/\b(complete|completed|done|passed|success|succeeded)\b/.test(normalizedMessage)) {
    return "done";
  }

  if (/\b(git|commit|branch|working tree|staged|unstaged)\b/.test(normalizedMessage)) {
    return "git";
  }

  if (/\b(verification|verify|verified|test|typecheck|lint|build)\b/.test(normalizedMessage)) {
    return "verify";
  }

  if (
    /\b(edit|edited|patch|patched|changed|created|updated|deleted|modified|file|files)\b/.test(
      normalizedMessage,
    )
  ) {
    return "edit";
  }

  if (/\b(npm|pnpm|yarn|node|tsx|powershell|pwsh)\b/.test(normalizedMessage)) {
    return "command";
  }

  return "agent";
}

function hasTranscriptEntry(
  entries: RuntimeTranscriptEntry[],
  entryId: string,
): boolean {
  return entries.some((entry) => entry.id === entryId);
}

function summaryEventId(
  summary: NonNullable<RunSummaryEvent>,
  progress: RunProgressEvent,
): string {
  return [
    "summary",
    progress.currentRun,
    progress.totalRuns ?? "unknown",
    summary.status,
    summary.message,
  ].join(":");
}

function isTerminalSummary(summary: NonNullable<RunSummaryEvent>): boolean {
  return (
    summary.status === "blocked" ||
    summary.status === "complete" ||
    summary.status === "failed" ||
    summary.status === "stopped"
  );
}

export function appendLogEntriesToTranscript(
  transcript: RuntimeTranscriptEntry[],
  entries: LogEntry[],
  progress: RunProgressEvent,
  receivedAt = Date.now(),
): RuntimeTranscriptEntry[] {
  if (entries.length === 0) {
    return transcript;
  }

  const seenLogIds = new Set(
    transcript
      .filter((entry): entry is RuntimeTranscriptLogEntry => entry.type === "log")
      .map((entry) => entry.sourceLogId),
  );
  const appendedEntries: RuntimeTranscriptLogEntry[] = [];

  for (const [index, entry] of entries.entries()) {
    if (seenLogIds.has(entry.id)) {
      continue;
    }

    seenLogIds.add(entry.id);
    appendedEntries.push({
      displayId: `#${entry.id}`,
      id: `log:${entry.id}`,
      kind: classifyTranscriptMessage(entry.message),
      message: entry.message,
      receivedAt: receivedAt + index,
      runIndex: progress.currentRun,
      sourceLogId: entry.id,
      stream: entry.stream,
      totalRuns: progress.totalRuns,
      type: "log",
    });
  }

  return appendedEntries.length > 0
    ? [...transcript, ...appendedEntries]
    : transcript;
}

export function appendProgressSeparatorToTranscript(
  transcript: RuntimeTranscriptEntry[],
  progress: RunProgressEvent,
  receivedAt = Date.now(),
): RuntimeTranscriptEntry[] {
  if (progress.currentRun <= 0) {
    return transcript;
  }

  const entryId = `progress:${progress.currentRun}:${progress.totalRuns ?? "unknown"}`;

  if (hasTranscriptEntry(transcript, entryId)) {
    return transcript;
  }

  return [
    ...transcript,
    {
      displayId: formatProgress(progress),
      id: entryId,
      kind: "agent",
      message: `Starting ${formatProgress(progress)}`,
      receivedAt,
      runIndex: progress.currentRun,
      separatorKind: "run-start",
      totalRuns: progress.totalRuns,
      type: "separator",
    },
  ];
}

export function appendSummarySeparatorToTranscript(
  transcript: RuntimeTranscriptEntry[],
  summary: RunSummaryEvent,
  progress: RunProgressEvent,
  receivedAt = Date.now(),
): RuntimeTranscriptEntry[] {
  if (!summary) {
    return transcript;
  }

  const entryId = summaryEventId(summary, progress);

  if (hasTranscriptEntry(transcript, entryId)) {
    return transcript;
  }

  const completion = isTerminalSummary(summary);

  return [
    ...transcript,
    {
      displayId: statusBadgeConfig[summary.status].label,
      id: entryId,
      kind: completion ? "done" : classifyTranscriptMessage(summary.message),
      message: summary.message,
      receivedAt,
      runIndex: progress.currentRun,
      separatorKind: completion ? "completion" : "summary",
      status: summary.status,
      totalRuns: progress.totalRuns,
      type: "separator",
    },
  ];
}
