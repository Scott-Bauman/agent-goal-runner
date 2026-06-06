import { describe, expect, it } from "vitest";

import {
  connectionStatusConfig,
  formatLogStream,
  formatProgress,
  INITIAL_RUNTIME_STREAM_STATE,
  parseSseData,
  type LogEntry,
} from "../../../src/web/events/runtimeStream";

describe("runtime stream helpers", () => {
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
});
