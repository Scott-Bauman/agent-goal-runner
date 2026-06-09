import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createInitialStreamState,
  createSseSnapshot,
  formatSseEvent,
  SseHub,
} from "../../../src/server/sse/sseHub";

describe("SSE hub", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it("creates the idle runtime stream state used by new servers", () => {
    expect(createInitialStreamState()).toEqual({
      runLoop: {
        status: "idle",
        stopRequested: false,
        activeProcessId: null,
        progress: {
          currentRun: 0,
          totalRuns: null,
        },
        latestSummary: null,
        details: {
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
            missing: [],
          },
        },
      },
      logs: [],
      runEvents: [],
    });
  });

  it("creates an initial snapshot for new clients", () => {
    const streamState = createInitialStreamState();
    streamState.runLoop.status = "running";
    streamState.runLoop.progress = {
      currentRun: 2,
      totalRuns: 3,
    };
    streamState.runLoop.latestSummary = {
      status: "running",
      message: "Still working.",
    };
    streamState.logs.push({
      id: 1,
      stream: "system",
      message: "queued",
    });
    streamState.runEvents.push({
      id: 1,
      kind: "run_started",
      message: "Started.",
      receivedAt: 123,
      runNumber: 2,
      totalRuns: 3,
    });
    streamState.runLoop.details = {
      ...streamState.runLoop.details,
      status: "running",
      currentRun: 2,
      totalRuns: 3,
      changedFiles: ["goal.md"],
    };

    expect(createSseSnapshot(streamState, "C:/repo")).toBe(
      [
        'event: status\ndata: {"status":"running","selectedRepositoryPath":"C:/repo"}\n\n',
        'event: logs\ndata: {"entries":[{"id":1,"stream":"system","message":"queued"}]}\n\n',
        'event: runEvents\ndata: {"entries":[{"id":1,"kind":"run_started","message":"Started.","receivedAt":123,"runNumber":2,"totalRuns":3}]}\n\n',
        'event: progress\ndata: {"currentRun":2,"totalRuns":3}\n\n',
        'event: summary\ndata: {"status":"running","message":"Still working."}\n\n',
        'event: runDetails\ndata: {"status":"running","currentRun":2,"totalRuns":3,"model":null,"reasoningEffort":null,"tokenCount":null,"changedFiles":["goal.md"],"warningCount":0,"errorCount":0,"stopReason":null,"lastAssistantMessage":null,"skillPreflight":{"checked":false,"found":[],"missing":[]}}\n\n',
      ].join(""),
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

  it("appends run events with progress context and broadcasts detail updates", () => {
    const hub = new SseHub();
    const streamState = createInitialStreamState();
    streamState.runLoop.progress = {
      currentRun: 2,
      totalRuns: 5,
    };
    const write = vi.fn(() => true);
    hub.registerClient(write);

    const event = hub.appendRunEvent(streamState, {
      kind: "patch_applied",
      message: "Patched files.",
      files: ["src/b.ts", "src/a.ts", "src/b.ts"],
    });

    expect(event).toEqual({
      id: 1,
      kind: "patch_applied",
      message: "Patched files.",
      files: ["src/b.ts", "src/a.ts", "src/b.ts"],
      receivedAt: 1_700_000_000_000,
      runNumber: 2,
      totalRuns: 5,
    });
    expect(streamState.runEvents).toEqual([event]);
    expect(streamState.runLoop.details.changedFiles).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
    expect(write).toHaveBeenNthCalledWith(
      1,
      'event: runEvents\ndata: {"entries":[{"kind":"patch_applied","message":"Patched files.","files":["src/b.ts","src/a.ts","src/b.ts"],"id":1,"receivedAt":1700000000000,"runNumber":2,"totalRuns":5}]}\n\n',
    );
    expect(write).toHaveBeenNthCalledWith(
      2,
      'event: runDetails\ndata: {"status":"idle","currentRun":0,"totalRuns":null,"model":null,"reasoningEffort":null,"tokenCount":null,"changedFiles":["src/a.ts","src/b.ts"],"warningCount":0,"errorCount":0,"stopReason":null,"lastAssistantMessage":null,"skillPreflight":{"checked":false,"found":[],"missing":[]}}\n\n',
    );
  });

  it("derives run detail counters and terminal metadata from run events", () => {
    const hub = new SseHub();
    const streamState = createInitialStreamState();

    hub.appendRunEvent(streamState, {
      kind: "warning",
      message: "Low context.",
    });
    hub.appendRunEvent(streamState, {
      kind: "error",
      message: "Codex failed.",
    });
    hub.appendRunEvent(streamState, {
      kind: "command_failed",
      message: "Typecheck failed.",
      stopReason: "verification_failed",
    });
    hub.appendRunEvent(streamState, {
      kind: "final_assistant_message",
      message: "Here is the summary.",
    });

    expect(streamState.runLoop.details).toMatchObject({
      warningCount: 1,
      errorCount: 2,
      stopReason: "verification_failed",
      lastAssistantMessage: "Here is the summary.",
    });
  });

  it("merges run detail patches while normalizing changed files", () => {
    const hub = new SseHub();
    const streamState = createInitialStreamState();
    const write = vi.fn(() => true);
    hub.registerClient(write);

    hub.updateRunDetails(streamState, {
      status: "running",
      currentRun: 1,
      totalRuns: 2,
      changedFiles: ["src/z.ts", "src/a.ts"],
      skillPreflight: {
        checked: true,
        found: ["goal-runner-framework"],
        missing: [],
      },
    });
    hub.updateRunDetails(streamState, {
      tokenCount: 42,
      changedFiles: ["src/a.ts", "src/m.ts"],
    });
    hub.updateRunDetails(streamState, {
      model: "gpt-5",
    });

    expect(streamState.runLoop.details).toEqual({
      status: "running",
      currentRun: 1,
      totalRuns: 2,
      model: "gpt-5",
      reasoningEffort: null,
      tokenCount: 42,
      changedFiles: ["src/a.ts", "src/m.ts", "src/z.ts"],
      warningCount: 0,
      errorCount: 0,
      stopReason: null,
      lastAssistantMessage: null,
      skillPreflight: {
        checked: true,
        found: ["goal-runner-framework"],
        missing: [],
      },
    });
    expect(write).toHaveBeenCalledTimes(3);
    expect(write).toHaveBeenLastCalledWith(
      'event: runDetails\ndata: {"status":"running","currentRun":1,"totalRuns":2,"model":"gpt-5","reasoningEffort":null,"tokenCount":42,"changedFiles":["src/a.ts","src/m.ts","src/z.ts"],"warningCount":0,"errorCount":0,"stopReason":null,"lastAssistantMessage":null,"skillPreflight":{"checked":true,"found":["goal-runner-framework"],"missing":[]}}\n\n',
    );
  });
});
