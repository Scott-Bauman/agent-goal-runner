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

export type RunEventKind =
  | "run_started"
  | "agent_session_started"
  | "codex_session_started"
  | "command_started"
  | "command_succeeded"
  | "command_failed"
  | "tool_started"
  | "tool_succeeded"
  | "tool_failed"
  | "file_changed"
  | "patch_applied"
  | "warning"
  | "error"
  | "final_assistant_message"
  | "run_completed";

export type RunEventEntry = {
  command?: string;
  exitCode?: number;
  files?: string[];
  id: number;
  kind: RunEventKind;
  message: string;
  receivedAt: number;
  runNumber: number;
  stopReason?: string;
  toolName?: string;
  totalRuns: number | null;
};

export type RunEventsEvent = {
  entries: RunEventEntry[];
};

export type TranscriptEventKind =
  | "agent"
  | "command"
  | "done"
  | "edit"
  | "error"
  | "git"
  | "tool"
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

export type SkillPreflightLocationStatus = {
  name: string;
  repoLocal: boolean;
  userGlobal: boolean;
  bundled: boolean;
  installed: boolean;
  paths: {
    repoLocal: string | null;
    userGlobal: string;
    bundled: string;
  };
};

export type SkillPreflightStatus = {
  checked: boolean;
  found: string[];
  locations: SkillPreflightLocationStatus[];
  missing: string[];
};

export type RunSummaryDetails = {
  status: RunnerStatus;
  currentRun: number;
  totalRuns: number | null;
  model: string | null;
  reasoningEffort: string | null;
  tokenCount: number | null;
  changedFiles: string[];
  warningCount: number;
  errorCount: number;
  stopReason: string | null;
  lastAssistantMessage: string | null;
  skillPreflight: SkillPreflightStatus;
};

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

export type RuntimeTranscriptRunEventEntry = RuntimeTranscriptEntryBase & {
  command?: string;
  eventKind: RunEventKind;
  exitCode?: number;
  files: string[];
  message: string;
  sourceEventId: number;
  toolName?: string;
  type: "run-event";
};

export type RuntimeTranscriptEntry =
  | RuntimeTranscriptLogEntry
  | RuntimeTranscriptRunEventEntry
  | RuntimeTranscriptSeparatorEntry;

export type RuntimeStreamState = {
  connectionStatus: "connecting" | "open" | "error";
  logs: RuntimeTranscriptEntry[];
  rawLogs: LogEntry[];
  progress: RunProgressEvent;
  latestSummary: RunSummaryEvent;
  runDetails: RunSummaryDetails;
};

export const INITIAL_RUNTIME_STREAM_STATE: RuntimeStreamState = {
  connectionStatus: "connecting",
  logs: [],
  rawLogs: [],
  progress: {
    currentRun: 0,
    totalRuns: null,
  },
  latestSummary: null,
  runDetails: {
    status: "idle",
    currentRun: 0,
    totalRuns: null,
    model: null,
    reasoningEffort: null,
    tokenCount: null,
    changedFiles: [],
    warningCount: 0,
    errorCount: 0,
    stopReason: null,
    lastAssistantMessage: null,
    skillPreflight: {
      checked: false,
      found: [],
      locations: [],
      missing: [],
    },
  },
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

export function appendRawLogEntries(
  logs: LogEntry[],
  entries: LogEntry[],
): LogEntry[] {
  if (entries.length === 0) {
    return logs;
  }

  const seenLogIds = new Set(logs.map((entry) => entry.id));
  const appendedEntries = entries.filter((entry) => {
    if (seenLogIds.has(entry.id)) {
      return false;
    }

    seenLogIds.add(entry.id);
    return true;
  });

  return appendedEntries.length > 0 ? [...logs, ...appendedEntries] : logs;
}

export function appendRunEventsToTranscript(
  transcript: RuntimeTranscriptEntry[],
  entries: RunEventEntry[],
): RuntimeTranscriptEntry[] {
  if (entries.length === 0) {
    return transcript;
  }

  const seenEventIds = new Set(
    transcript
      .filter(
        (entry): entry is RuntimeTranscriptRunEventEntry =>
          entry.type === "run-event",
      )
      .map((entry) => entry.sourceEventId),
  );
  const appendedEntries: RuntimeTranscriptRunEventEntry[] = [];

  let nextTranscript = transcript;

  for (const entry of entries) {
    if (seenEventIds.has(entry.id)) {
      continue;
    }

    seenEventIds.add(entry.id);
    nextTranscript = removeTranscriptRowsDuplicatedByRunEvent(
      nextTranscript,
      entry,
    );
    appendedEntries.push({
      command: entry.command,
      displayId: `#${entry.id}`,
      eventKind: entry.kind,
      exitCode: entry.exitCode,
      files: entry.files ?? [],
      id: `event:${entry.id}`,
      kind: transcriptKindForRunEvent(entry.kind),
      message: entry.message,
      receivedAt: entry.receivedAt,
      runIndex: entry.runNumber,
      sourceEventId: entry.id,
      toolName: entry.toolName,
      totalRuns: entry.totalRuns,
      type: "run-event",
    });
  }

  return appendedEntries.length > 0
    ? [...nextTranscript, ...appendedEntries]
    : nextTranscript;
}

export function appendLogEntriesToTranscript(
  transcript: RuntimeTranscriptEntry[],
  entries: LogEntry[],
  progress: RunProgressEvent,
  receivedAt = Date.now(),
): RuntimeTranscriptEntry[] {
  const visibleEntries = entries.filter(shouldShowLogEntryInTranscript);

  if (visibleEntries.length === 0) {
    return transcript;
  }

  const seenLogIds = new Set(
    transcript
      .filter((entry): entry is RuntimeTranscriptLogEntry => entry.type === "log")
      .map((entry) => entry.sourceLogId),
  );
  const appendedEntries: RuntimeTranscriptLogEntry[] = [];

  for (const [index, entry] of visibleEntries.entries()) {
    if (
      seenLogIds.has(entry.id) ||
      isLogEntryDuplicatedByTranscript(entry, transcript)
    ) {
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

function shouldShowLogEntryInTranscript(entry: LogEntry): boolean {
  if (entry.stream !== "stdout") {
    return true;
  }

  return !isStructuredAgentJsonLog(entry.message);
}

function removeTranscriptRowsDuplicatedByRunEvent(
  transcript: RuntimeTranscriptEntry[],
  event: RunEventEntry,
): RuntimeTranscriptEntry[] {
  if (
    event.kind !== "final_assistant_message" &&
    event.kind !== "run_completed"
  ) {
    return transcript;
  }

  const eventMessage = normalizeTranscriptMessage(event.message);

  return transcript.filter((entry) => {
    const entryMessage = normalizeTranscriptMessage(entry.message);

    if (entryMessage !== eventMessage) {
      return true;
    }

    if (event.kind === "final_assistant_message") {
      return entry.type !== "log";
    }

    return (
      entry.type !== "separator" ||
      entry.separatorKind !== "completion"
    );
  });
}

function isLogEntryDuplicatedByTranscript(
  logEntry: LogEntry,
  transcript: RuntimeTranscriptEntry[],
): boolean {
  const logMessage = normalizeTranscriptMessage(logEntry.message);

  return transcript.some((entry) => {
    if (normalizeTranscriptMessage(entry.message) !== logMessage) {
      return false;
    }

    return (
      (entry.type === "run-event" &&
        entry.eventKind === "final_assistant_message") ||
      (entry.type === "separator" && entry.separatorKind === "completion")
    );
  });
}

function normalizeTranscriptMessage(message: string): string {
  return message.trim().replace(/\s+/g, " ");
}

function isStructuredAgentJsonLog(message: string): boolean {
  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return (
    lines.length > 0 &&
    lines.every((line) => {
      try {
        const parsed = JSON.parse(line) as unknown;

        return (
          typeof parsed === "object" &&
          parsed !== null &&
          ("type" in parsed ||
            "event" in parsed ||
            "name" in parsed ||
            "kind" in parsed)
        );
      } catch {
        return false;
      }
    })
  );
}

function transcriptKindForRunEvent(kind: RunEventKind): TranscriptEventKind {
  switch (kind) {
    case "command_started":
      return "command";
    case "command_succeeded":
    case "run_completed":
      return "done";
    case "command_failed":
    case "error":
      return "error";
    case "tool_started":
      return "tool";
    case "tool_succeeded":
      return "done";
    case "tool_failed":
      return "error";
    case "file_changed":
    case "patch_applied":
      return "edit";
    case "warning":
      return "warn";
    case "agent_session_started":
    case "codex_session_started":
    case "final_assistant_message":
    case "run_started":
      return "agent";
  }
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

  if (completion && hasMatchingRunCompletedEvent(transcript, summary.message)) {
    return transcript;
  }

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

function hasMatchingRunCompletedEvent(
  transcript: RuntimeTranscriptEntry[],
  message: string,
): boolean {
  const normalizedMessage = normalizeTranscriptMessage(message);

  return transcript.some(
    (entry) =>
      entry.type === "run-event" &&
      entry.eventKind === "run_completed" &&
      normalizeTranscriptMessage(entry.message) === normalizedMessage,
  );
}
