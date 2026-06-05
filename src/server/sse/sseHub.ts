import type { LogEntry, RuntimeStreamState, SseClient, SseEventMap } from "./types.js";

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
    },
    logs: [],
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
    formatSseEvent("progress", streamState.runLoop.progress),
    formatSseEvent("summary", streamState.runLoop.latestSummary),
  ].join("");
}

export class SseHub {
  private readonly clients = new Map<number, SseClient>();
  private nextClientId = 1;
  private nextLogId = 1;

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
    const message = typeof chunk === "string" ? chunk : chunk.toString("utf8");

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
    this.broadcast("logs", {
      entries: [entry],
    });
  }
}
