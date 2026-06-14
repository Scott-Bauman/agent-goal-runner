import type {
  LogEntry,
  RunEvent,
  RunEventPayload,
  RunSummaryDetails,
  RuntimeStreamState,
  SseClient,
  SseEventMap,
} from "./types.js";

export const MAX_RETAINED_LOG_ENTRIES = 500;
export const MAX_RETAINED_RUN_EVENTS = 500;
export const MAX_SSE_MESSAGE_BYTES = 64 * 1024;

const TRUNCATED_MESSAGE_SUFFIX = "\n...[truncated]";

function createInitialRunDetails(): RunSummaryDetails {
  return {
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
  };
}

export function createInitialStreamState(): RuntimeStreamState {
  return {
    runLoop: {
      status: "idle",
      stopRequested: false,
      activeProcessId: null,
      progress: {
        currentRun: 0,
        totalRuns: null,
      },
      latestSummary: null,
      details: createInitialRunDetails(),
    },
    logs: [],
    runEvents: [],
  };
}

export function formatSseEvent<EventName extends keyof SseEventMap>(
  event: EventName,
  data: SseEventMap[EventName],
): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function createSseSnapshot(
  streamState: RuntimeStreamState,
  selectedRepositoryPath: string | null,
): string {
  return [
    formatSseEvent("status", {
      status: streamState.runLoop.status,
      selectedRepositoryPath,
    }),
    formatSseEvent("logs", {
      entries: streamState.logs,
    }),
    formatSseEvent("runEvents", {
      entries: streamState.runEvents,
    }),
    formatSseEvent("progress", streamState.runLoop.progress),
    formatSseEvent("summary", streamState.runLoop.latestSummary),
    formatSseEvent("runDetails", streamState.runLoop.details),
  ].join("");
}

function truncateMessage(message: string): string {
  if (Buffer.byteLength(message, "utf8") <= MAX_SSE_MESSAGE_BYTES) {
    return message;
  }

  const suffixBytes = Buffer.byteLength(TRUNCATED_MESSAGE_SUFFIX, "utf8");
  const availableBytes = Math.max(0, MAX_SSE_MESSAGE_BYTES - suffixBytes);
  let truncated = Buffer.from(message, "utf8")
    .subarray(0, availableBytes)
    .toString("utf8");

  while (
    truncated.length > 0 &&
    Buffer.byteLength(`${truncated}${TRUNCATED_MESSAGE_SUFFIX}`, "utf8") >
      MAX_SSE_MESSAGE_BYTES
  ) {
    truncated = truncated.slice(0, -1);
  }

  return `${truncated}${TRUNCATED_MESSAGE_SUFFIX}`;
}

function retainLatestEntries<T>(entries: T[], maximum: number): void {
  if (entries.length > maximum) {
    entries.splice(0, entries.length - maximum);
  }
}

export class SseHub {
  private readonly clients = new Map<number, SseClient>();
  private nextClientId = 1;
  private nextLogId = 1;
  private nextRunEventId = 1;

  broadcast<EventName extends keyof SseEventMap>(
    event: EventName,
    data: SseEventMap[EventName],
  ): void {
    const chunk = formatSseEvent(event, data);

    for (const client of this.clients.values()) {
      client.write(chunk);
    }
  }

  registerClient(write: (chunk: string) => boolean): SseClient {
    const client: SseClient = {
      id: this.nextClientId,
      write,
    };
    this.nextClientId += 1;
    this.clients.set(client.id, client);
    return client;
  }

  unregisterClient(clientId: number): void {
    this.clients.delete(clientId);
  }

  appendProcessLog(
    streamState: RuntimeStreamState,
    stream: Extract<LogEntry["stream"], "stdout" | "stderr">,
    chunk: Buffer | string,
  ): void {
    this.appendLogEntry(streamState, stream, chunk);
  }

  private appendLogEntry(
    streamState: RuntimeStreamState,
    stream: LogEntry["stream"],
    chunk: Buffer | string,
  ): void {
    const message = truncateMessage(
      typeof chunk === "string" ? chunk : chunk.toString("utf8"),
    );

    if (message.length === 0) {
      return;
    }

    const entry: LogEntry = {
      id: this.nextLogId,
      stream,
      message,
    };
    this.nextLogId += 1;
    streamState.logs.push(entry);
    retainLatestEntries(streamState.logs, MAX_RETAINED_LOG_ENTRIES);
    this.broadcast("logs", {
      entries: [entry],
    });
  }

  appendRunEvent(
    streamState: RuntimeStreamState,
    payload: RunEventPayload,
  ): RunEvent {
    const entry: RunEvent = {
      ...payload,
      command:
        payload.command === undefined ? undefined : truncateMessage(payload.command),
      message: truncateMessage(payload.message),
      stopReason:
        payload.stopReason === undefined
          ? undefined
          : truncateMessage(payload.stopReason),
      toolName:
        payload.toolName === undefined
          ? undefined
          : truncateMessage(payload.toolName),
      id: this.nextRunEventId,
      receivedAt: Date.now(),
      runNumber: streamState.runLoop.progress.currentRun,
      totalRuns: streamState.runLoop.progress.totalRuns,
    };
    this.nextRunEventId += 1;
    streamState.runEvents.push(entry);
    retainLatestEntries(streamState.runEvents, MAX_RETAINED_RUN_EVENTS);
    streamState.runLoop.details = updateRunDetailsFromEvent(
      streamState.runLoop.details,
      entry,
    );
    this.broadcast("runEvents", {
      entries: [entry],
    });
    this.broadcast("runDetails", streamState.runLoop.details);
    return entry;
  }

  updateRunDetails(
    streamState: RuntimeStreamState,
    patch: Partial<RunSummaryDetails>,
  ): void {
    const changedFiles =
      patch.changedFiles === undefined
        ? streamState.runLoop.details.changedFiles
        : [
            ...streamState.runLoop.details.changedFiles,
            ...patch.changedFiles,
          ];
    streamState.runLoop.details = normalizeRunDetails({
      ...streamState.runLoop.details,
      ...patch,
      changedFiles,
    });
    this.broadcast("runDetails", streamState.runLoop.details);
  }
}

function updateRunDetailsFromEvent(
  details: RunSummaryDetails,
  event: RunEvent,
): RunSummaryDetails {
  const changedFiles = new Set(details.changedFiles);

  for (const file of event.files ?? []) {
    changedFiles.add(file);
  }

  return normalizeRunDetails({
    ...details,
    changedFiles: Array.from(changedFiles),
    errorCount:
      event.kind === "error" ||
      event.kind === "command_failed" ||
      event.kind === "tool_failed"
        ? details.errorCount + 1
        : details.errorCount,
    lastAssistantMessage:
      event.kind === "final_assistant_message"
        ? event.message
        : details.lastAssistantMessage,
    stopReason: event.stopReason ?? details.stopReason,
    warningCount:
      event.kind === "warning" ? details.warningCount + 1 : details.warningCount,
  });
}

function normalizeRunDetails(details: RunSummaryDetails): RunSummaryDetails {
  return {
    ...details,
    changedFiles: Array.from(new Set(details.changedFiles)).sort((first, second) =>
      first.localeCompare(second),
    ),
  };
}
