import { describe, expect, it } from "vitest";

import {
  appendLogEntriesToTranscript,
  appendProgressSeparatorToTranscript,
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
      progress: {
        currentRun: 0,
        totalRuns: null,
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
});
