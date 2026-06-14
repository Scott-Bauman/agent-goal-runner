import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createInitialStreamState,
  createSseSnapshot,
  formatSseEvent,
  MAX_RETAINED_LOG_ENTRIES,
  MAX_RETAINED_RUN_EVENTS,
  MAX_SSE_MESSAGE_BYTES,
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
            locations: [],
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
        'event: runDetails\ndata: {"status":"running","currentRun":2,"totalRuns":3,"model":null,"reasoningEffort":null,"tokenCount":null,"changedFiles":["goal.md"],"warningCount":0,"errorCount":0,"stopReason":null,"lastAssistantMessage":null,"skillPreflight":{"checked":false,"found":[],"locations":[],"missing":[]}}\n\n',
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

  it("retains only the latest process logs and truncates oversized log chunks", () => {
    const hub = new SseHub();
    const streamState = createInitialStreamState();

    for (let index = 0; index < MAX_RETAINED_LOG_ENTRIES + 2; index += 1) {
      hub.appendProcessLog(streamState, "stdout", `line ${index}`);
    }

    hub.appendProcessLog(streamState, "stderr", "x".repeat(MAX_SSE_MESSAGE_BYTES + 100));

    expect(streamState.logs).toHaveLength(MAX_RETAINED_LOG_ENTRIES);
    expect(streamState.logs[0].id).toBe(4);
    expect(streamState.logs.at(-1)).toMatchObject({
      id: MAX_RETAINED_LOG_ENTRIES + 3,
      stream: "stderr",
    });
    expect(Buffer.byteLength(streamState.logs.at(-1)?.message ?? "", "utf8")).toBeLessThanOrEqual(
      MAX_SSE_MESSAGE_BYTES,
    );
    expect(streamState.logs.at(-1)?.message).toContain("...[truncated]");
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
      'event: runDetails\ndata: {"status":"idle","currentRun":0,"totalRuns":null,"model":null,"reasoningEffort":null,"tokenCount":null,"changedFiles":["src/a.ts","src/b.ts"],"warningCount":0,"errorCount":0,"stopReason":null,"lastAssistantMessage":null,"skillPreflight":{"checked":false,"found":[],"locations":[],"missing":[]}}\n\n',
    );
  });

  it("retains only the latest run events and truncates oversized event fields", () => {
    const hub = new SseHub();
    const streamState = createInitialStreamState();

    for (let index = 0; index < MAX_RETAINED_RUN_EVENTS + 2; index += 1) {
      hub.appendRunEvent(streamState, {
        kind: "command_started",
        message: `Started command ${index}.`,
      });
    }

    const event = hub.appendRunEvent(streamState, {
      command: "c".repeat(MAX_SSE_MESSAGE_BYTES + 100),
      kind: "command_failed",
      message: "m".repeat(MAX_SSE_MESSAGE_BYTES + 100),
      stopReason: "s".repeat(MAX_SSE_MESSAGE_BYTES + 100),
      toolName: "t".repeat(MAX_SSE_MESSAGE_BYTES + 100),
    });

    expect(streamState.runEvents).toHaveLength(MAX_RETAINED_RUN_EVENTS);
    expect(streamState.runEvents[0].id).toBe(4);
    expect(streamState.runEvents.at(-1)).toBe(event);
    expect(Buffer.byteLength(event.message, "utf8")).toBeLessThanOrEqual(
      MAX_SSE_MESSAGE_BYTES,
    );
    expect(Buffer.byteLength(event.command ?? "", "utf8")).toBeLessThanOrEqual(
      MAX_SSE_MESSAGE_BYTES,
    );
    expect(Buffer.byteLength(event.stopReason ?? "", "utf8")).toBeLessThanOrEqual(
      MAX_SSE_MESSAGE_BYTES,
    );
    expect(Buffer.byteLength(event.toolName ?? "", "utf8")).toBeLessThanOrEqual(
      MAX_SSE_MESSAGE_BYTES,
    );
    expect(event.message).toContain("...[truncated]");
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
      files: ["src/web/App.tsx"],
      kind: "file_changed",
      message: "Updated src/web/App.tsx.",
    });
    hub.appendRunEvent(streamState, {
      files: ["src/server/runner/piJsonEvents.ts", "src/web/App.tsx"],
      kind: "tool_succeeded",
      message: "Edit tool completed.",
      toolName: "Edit",
    });
    hub.appendRunEvent(streamState, {
      kind: "tool_failed",
      message: "Bash tool failed.",
      stopReason: "tool_error",
      toolName: "Bash",
    });
    hub.appendRunEvent(streamState, {
      kind: "final_assistant_message",
      message: "Here is the summary.",
    });

    expect(streamState.runLoop.details).toMatchObject({
      changedFiles: ["src/server/runner/piJsonEvents.ts", "src/web/App.tsx"],
      warningCount: 1,
      errorCount: 3,
      stopReason: "tool_error",
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
        locations: [],
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
        locations: [],
        missing: [],
      },
    });
    expect(write).toHaveBeenCalledTimes(3);
    expect(write).toHaveBeenLastCalledWith(
      'event: runDetails\ndata: {"status":"running","currentRun":1,"totalRuns":2,"model":"gpt-5","reasoningEffort":null,"tokenCount":42,"changedFiles":["src/a.ts","src/m.ts","src/z.ts"],"warningCount":0,"errorCount":0,"stopReason":null,"lastAssistantMessage":null,"skillPreflight":{"checked":true,"found":["goal-runner-framework"],"locations":[],"missing":[]}}\n\n',
    );
  });
});
