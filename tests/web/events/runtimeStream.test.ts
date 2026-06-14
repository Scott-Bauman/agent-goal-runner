import { describe, expect, it } from "vitest";

import {
  appendLogEntriesToTranscript,
  appendProgressSeparatorToTranscript,
  appendRawLogEntries,
  appendRunEventsToTranscript,
  appendSummarySeparatorToTranscript,
  connectionStatusConfig,
  formatLogStream,
  formatProgress,
  INITIAL_RUNTIME_STREAM_STATE,
  parseSseData,
  type LogEntry,
  type RunProgressEvent,
} from "../../../src/web/events/runtimeStream";

describe("runtime stream helpers", () => {
  const runningProgress: RunProgressEvent = {
    currentRun: 1,
    totalRuns: 2,
  };

  it("defines the initial stream state", () => {
    expect(INITIAL_RUNTIME_STREAM_STATE).toEqual({
      connectionStatus: "connecting",
      latestSummary: null,
      logs: [],
      rawLogs: [],
      progress: {
        currentRun: 0,
        totalRuns: null,
      },
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
    });
  });

  it("parses valid SSE JSON payloads", () => {
    const event = {
      data: JSON.stringify({
        status: "running",
        selectedRepositoryPath: "C:\\repo",
      }),
    } as MessageEvent<string>;

    expect(
      parseSseData<{
        selectedRepositoryPath: string;
        status: string;
      }>(event),
    ).toEqual({
      status: "running",
      selectedRepositoryPath: "C:\\repo",
    });
  });

  it("returns null for invalid SSE JSON payloads", () => {
    const event = {
      data: "{not-json",
    } as MessageEvent<string>;

    expect(parseSseData(event)).toBeNull();
  });

  it("formats progress for inactive and bounded runs", () => {
    expect(formatProgress({ currentRun: 0, totalRuns: null })).toBe(
      "No active run",
    );
    expect(formatProgress({ currentRun: 2, totalRuns: null })).toBe("Run 2");
    expect(formatProgress({ currentRun: 2, totalRuns: 5 })).toBe(
      "Run 2 of 5",
    );
    expect(formatProgress({ currentRun: 0, totalRuns: 5 })).toBe(
      "No active run",
    );
    expect(formatProgress({ currentRun: 1, totalRuns: 0 })).toBe(
      "No active run",
    );
  });

  it.each<LogEntry["stream"]>(["system", "stdout", "stderr"])(
    "formats %s log stream labels",
    (stream) => {
      expect(formatLogStream(stream)).toBe(stream);
    },
  );

  it("defines connection status badge labels and variants", () => {
    expect(connectionStatusConfig).toEqual({
      connecting: {
        label: "SSE Connecting",
        variant: "outline",
      },
      error: {
        label: "SSE Stream Error",
        variant: "destructive",
      },
      open: {
        label: "SSE Stream Open",
        variant: "secondary",
      },
    });
  });

  it("appends incremental log payloads instead of replacing transcript rows", () => {
    const firstBatch = appendLogEntriesToTranscript(
      [],
      [{ id: 1, message: "first", stream: "stdout" }],
      runningProgress,
      100,
    );
    const secondBatch = appendLogEntriesToTranscript(
      firstBatch,
      [{ id: 2, message: "second", stream: "stdout" }],
      runningProgress,
      200,
    );

    expect(secondBatch.map((entry) => entry.message)).toEqual([
      "first",
      "second",
    ]);
    expect(secondBatch[1]).toMatchObject({
      displayId: "#2",
      id: "log:2",
      runIndex: 1,
      sourceLogId: 2,
      totalRuns: 2,
      type: "log",
    });
  });

  it("appends raw logs separately from structured transcript events", () => {
    const logs = appendRawLogEntries(
      [],
      [{ id: 1, message: "raw stdout", stream: "stdout" }],
    );

    expect(appendRawLogEntries(logs, [])).toBe(logs);
    expect(
      appendRawLogEntries(logs, [
        { id: 1, message: "raw stdout", stream: "stdout" },
        { id: 2, message: "raw stderr", stream: "stderr" },
      ]),
    ).toEqual([
      { id: 1, message: "raw stdout", stream: "stdout" },
      { id: 2, message: "raw stderr", stream: "stderr" },
    ]);
  });

  it("appends structured run events as the primary transcript rows", () => {
    const transcript = appendRunEventsToTranscript([], [
      {
        command: "npm test",
        id: 1,
        kind: "command_started",
        message: "Started verification.",
        receivedAt: 100,
        runNumber: 1,
        totalRuns: 1,
      },
      {
        files: ["src/web/App.tsx"],
        id: 2,
        kind: "file_changed",
        message: "Updated src/web/App.tsx",
        receivedAt: 200,
        runNumber: 1,
        totalRuns: 1,
      },
    ]);

    expect(transcript).toEqual([
      expect.objectContaining({
        command: "npm test",
        eventKind: "command_started",
        id: "event:1",
        kind: "command",
        sourceEventId: 1,
        type: "run-event",
      }),
      expect.objectContaining({
        eventKind: "file_changed",
        files: ["src/web/App.tsx"],
        id: "event:2",
        kind: "edit",
        sourceEventId: 2,
        type: "run-event",
      }),
    ]);
    expect(
      appendRunEventsToTranscript(transcript, [
        {
          id: 1,
          kind: "command_started",
          message: "Started verification.",
          receivedAt: 100,
          runNumber: 1,
          totalRuns: 1,
        },
      ]),
    ).toBe(transcript);
  });

  it("replaces duplicated stdout with the final assistant run event", () => {
    const stdoutTranscript = appendLogEntriesToTranscript(
      [],
      [{ id: 1, message: "Done.\n\nUpdated goal.md", stream: "stdout" }],
      runningProgress,
      100,
    );
    const finalTranscript = appendRunEventsToTranscript(stdoutTranscript, [
      {
        id: 1,
        kind: "final_assistant_message",
        message: "Done.\n\nUpdated goal.md",
        receivedAt: 200,
        runNumber: 1,
        totalRuns: 2,
      },
    ]);

    expect(finalTranscript).toEqual([
      expect.objectContaining({
        eventKind: "final_assistant_message",
        id: "event:1",
        message: "Done.\n\nUpdated goal.md",
        type: "run-event",
      }),
    ]);
  });

  it("dedupes duplicate snapshot log entries by stable backend id", () => {
    const snapshot = appendLogEntriesToTranscript(
      [],
      [
        { id: 1, message: "first", stream: "stdout" },
        { id: 2, message: "second", stream: "stderr" },
      ],
      runningProgress,
      100,
    );
    const reconnectedSnapshot = appendLogEntriesToTranscript(
      snapshot,
      [
        { id: 1, message: "first", stream: "stdout" },
        { id: 2, message: "second", stream: "stderr" },
        { id: 3, message: "third", stream: "stdout" },
      ],
      runningProgress,
      200,
    );

    expect(
      reconnectedSnapshot
        .filter((entry) => entry.type === "log")
        .map((entry) => entry.sourceLogId),
    ).toEqual([1, 2, 3]);
  });

  it("keeps structured Codex JSON stdout out of the visible transcript", () => {
    const transcript = appendLogEntriesToTranscript(
      [],
      [
        {
          id: 1,
          message: JSON.stringify({
            type: "command.started",
            command: "npm test",
          }),
          stream: "stdout",
        },
        {
          id: 2,
          message: "human-readable stderr",
          stream: "stderr",
        },
      ],
      runningProgress,
      100,
    );

    expect(transcript).toEqual([
      expect.objectContaining({
        id: "log:2",
        message: "human-readable stderr",
        stream: "stderr",
        type: "log",
      }),
    ]);
  });

  it("keeps existing transcript rows when a log snapshot is empty", () => {
    const transcript = appendLogEntriesToTranscript(
      [],
      [{ id: 1, message: "first", stream: "stdout" }],
      runningProgress,
      100,
    );

    expect(
      appendLogEntriesToTranscript(transcript, [], runningProgress, 200),
    ).toBe(transcript);
  });

  it("creates ordered progress and summary separators", () => {
    const runOne = appendProgressSeparatorToTranscript(
      [],
      runningProgress,
      100,
    );
    const runOneSummary = appendSummarySeparatorToTranscript(
      runOne,
      {
        message: "Started Codex run 1 of 2.",
        status: "running",
      },
      runningProgress,
      200,
    );
    const runTwoProgress = {
      currentRun: 2,
      totalRuns: 2,
    };
    const runTwo = appendProgressSeparatorToTranscript(
      runOneSummary,
      runTwoProgress,
      300,
    );
    const complete = appendSummarySeparatorToTranscript(
      runTwo,
      {
        message: "Completed run loop.",
        status: "complete",
      },
      runTwoProgress,
      400,
    );

    expect(complete.map((entry) => entry.message)).toEqual([
      "Starting Run 1 of 2",
      "Started Codex run 1 of 2.",
      "Starting Run 2 of 2",
      "Completed run loop.",
    ]);
    expect(complete.map((entry) => entry.type)).toEqual([
      "separator",
      "separator",
      "separator",
      "separator",
    ]);
    expect(complete.map((entry) => entry.kind)).toEqual([
      "agent",
      "agent",
      "agent",
      "done",
    ]);
  });

  it("does not add a terminal summary when the completion event is already visible", () => {
    const completedTranscript = appendRunEventsToTranscript([], [
      {
        id: 1,
        kind: "run_completed",
        message: "Completed Pi run 1 of 1 and refreshed goal.md.",
        receivedAt: 100,
        runNumber: 1,
        totalRuns: 1,
      },
    ]);
    const summarizedTranscript = appendSummarySeparatorToTranscript(
      completedTranscript,
      {
        message: "Completed Pi run 1 of 1 and refreshed goal.md.",
        status: "complete",
      },
      {
        currentRun: 1,
        totalRuns: 1,
      },
      200,
    );

    expect(summarizedTranscript).toBe(completedTranscript);
    expect(summarizedTranscript).toHaveLength(1);
  });
});
