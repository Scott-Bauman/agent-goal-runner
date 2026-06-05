import { describe, expect, it, vi } from "vitest";

import {
  createInitialStreamState,
  createSseSnapshot,
  formatSseEvent,
  SseHub,
} from "../../../src/server/sse/sseHub";

describe("SSE hub", () => {
  it("formats named SSE events as JSON data blocks", () => {
    expect(
      formatSseEvent("summary", {
        status: "running",
        message: "Started Codex run 1 of 1.",
      }),
    ).toBe(
      'event: summary\ndata: {"status":"running","message":"Started Codex run 1 of 1."}\n\n',
    );
  });

  it("creates an initial snapshot for new clients", () => {
    expect(createSseSnapshot(createInitialStreamState(), "C:/repo")).toContain(
      'event: status\ndata: {"status":"idle","selectedRepositoryPath":"C:/repo"}',
    );
  });

  it("broadcasts events and unregisters clients", () => {
    const hub = new SseHub();
    const write = vi.fn(() => true);
    const client = hub.registerClient(write);

    hub.broadcast("summary", null);
    hub.unregisterClient(client.id);
    hub.broadcast("summary", {
      status: "complete",
      message: "Done.",
    });

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith("event: summary\ndata: null\n\n");
  });

  it("appends non-empty process logs with incrementing ids", () => {
    const hub = new SseHub();
    const streamState = createInitialStreamState();
    const write = vi.fn(() => true);
    hub.registerClient(write);

    hub.appendProcessLog(streamState, "stdout", "hello\n");
    hub.appendProcessLog(streamState, "stderr", Buffer.from(""));

    expect(streamState.logs).toEqual([
      {
        id: 1,
        stream: "stdout",
        message: "hello\n",
      },
    ]);
    expect(write).toHaveBeenCalledWith(
      'event: logs\ndata: {"entries":[{"id":1,"stream":"stdout","message":"hello\\n"}]}\n\n',
    );
  });
});
