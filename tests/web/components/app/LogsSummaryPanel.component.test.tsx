// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LogConsole } from "../../../../src/web/components/app/LogConsole";
import { LogsSummaryPanel } from "../../../../src/web/components/app/LogsSummaryPanel";
import type {
  LogEntry,
  RuntimeTranscriptEntry,
} from "../../../../src/web/events/runtimeStream";

import { createRuntimeStreamState } from "./componentTestUtils";

function logEntry(
  overrides: Partial<RuntimeTranscriptEntry>,
): RuntimeTranscriptEntry {
  return {
    displayId: "#1",
    id: "log:1",
    kind: "agent",
    message: "Agent is ready",
    receivedAt: 1_000,
    runIndex: 1,
    sourceLogId: 1,
    stream: "stdout",
    totalRuns: 2,
    type: "log",
    ...overrides,
  } as RuntimeTranscriptEntry;
}

describe("LogsSummaryPanel", () => {
  it("renders run details and transcript activity", () => {
    const runtimeStream = createRuntimeStreamState({
      logs: [
        logEntry({
          id: "log:1",
          kind: "command",
          message: "npm test\n```txt\npassed\n```",
          receivedAt: 1_000,
          sourceLogId: 1,
          stream: "stdout",
        }),
      ],
      progress: {
        currentRun: 1,
        totalRuns: 2,
      },
      runDetails: {
        changedFiles: [],
        currentRun: 1,
        errorCount: 0,
        lastAssistantMessage: null,
        model: "gpt-5.4",
        reasoningEffort: "high",
        skillPreflight: {
          checked: false,
          found: [],
          locations: [],
          missing: [],
        },
        status: "running",
        stopReason: null,
        tokenCount: null,
        totalRuns: 2,
        warningCount: 0,
      },
    });

    render(
      <LogsSummaryPanel
        onClearOutput={() => undefined}
        runnerStatus="running"
        runtimeStream={runtimeStream}
      />,
    );

    expect(screen.getByText("Agent Output")).toBeTruthy();
    expect(screen.getAllByText("Run 1 of 2").length).toBeGreaterThan(0);
    expect(screen.getByRole("status", { name: "Runner status: Running" })).toBeTruthy();
    expect(screen.getByText("gpt-5.4")).toBeTruthy();
    expect(screen.getByText("high")).toBeTruthy();
    expect(screen.getByText("[command]")).toBeTruthy();
    expect(screen.getByText("txt")).toBeTruthy();
    expect(screen.getByText("passed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Clear Output" })).toBeNull();
  });

  it("lets the user clear output only when the runner is inactive", () => {
    const onClearOutput = vi.fn();
    const runtimeStream = createRuntimeStreamState();
    const { rerender } = render(
      <LogsSummaryPanel
        onClearOutput={onClearOutput}
        runnerStatus="complete"
        runtimeStream={runtimeStream}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear Output" }));

    expect(onClearOutput).toHaveBeenCalledTimes(1);

    rerender(
      <LogsSummaryPanel
        onClearOutput={onClearOutput}
        runnerStatus="running"
        runtimeStream={runtimeStream}
      />,
    );

    expect(screen.queryByRole("button", { name: "Clear Output" })).toBeNull();
  });
});

describe("LogConsole", () => {
  it("shows the idle state and raw logs when no transcript entries exist", () => {
    const rawLogs: LogEntry[] = [
      {
        id: 1,
        message: "raw backend line",
        stream: "stderr",
      },
    ];

    render(<LogConsole logs={[]} rawLogs={rawLogs} runnerStatus="idle" />);

    expect(screen.getByText("waiting for agent run")).toBeTruthy();
    expect(screen.getByText("Raw logs (1)")).toBeTruthy();
    expect(screen.getByText("raw backend line")).toBeTruthy();
  });

  it("renders path highlights and final assistant run events", () => {
    render(
      <LogConsole
        rawLogs={[]}
        runnerStatus="complete"
        logs={[
          logEntry({
            id: "log:1",
            message:
              "Updated C:\\repo\\agent-goal-runner\\src\\web\\App.tsx",
          }),
          {
            command: undefined,
            displayId: "#2",
            eventKind: "final_assistant_message",
            exitCode: undefined,
            files: [],
            id: "event:2",
            kind: "agent",
            message: "Final assistant response",
            receivedAt: 1_001,
            runIndex: 1,
            sourceEventId: 2,
            totalRuns: 2,
            type: "run-event",
          },
        ]}
      />,
    );

    const path = screen.getByText("src/web/App.tsx");

    expect(path.getAttribute("title")).toBe(
      "C:\\repo\\agent-goal-runner\\src\\web\\App.tsx",
    );
    expect(screen.getByText("Final assistant response")).toBeTruthy();
  });

  it("shows a visible running pulse while the agent process is active", () => {
    render(<LogConsole logs={[]} rawLogs={[]} runnerStatus="running" />);

    expect(screen.getByRole("status", { name: "agent process running" })).toBeTruthy();
    expect(screen.queryByText("waiting for agent run")).toBeNull();
  });

  it("keeps the running pulse visible when an active run has gone quiet", () => {
    render(
      <LogConsole
        logs={[logEntry({ message: "Started Claude run 1 of 1." })]}
        rawLogs={[]}
        runnerStatus="running"
      />,
    );

    expect(screen.getByRole("status", { name: "agent process running" })).toBeTruthy();
    expect(screen.getByText("Started Claude run 1 of 1.")).toBeTruthy();
  });

  it("lets the user jump back to the latest log after scrolling away", async () => {
    render(
      <LogConsole
        logs={[logEntry({})]}
        rawLogs={[]}
        runnerStatus="running"
      />,
    );

    const scrollContainer = screen.getAllByRole("list")[0]?.parentElement;

    if (!scrollContainer) {
      throw new Error("Expected log scroll container.");
    }

    Object.defineProperties(scrollContainer, {
      clientHeight: {
        configurable: true,
        value: 100,
      },
      scrollHeight: {
        configurable: true,
        value: 400,
      },
      scrollTop: {
        configurable: true,
        value: 0,
        writable: true,
      },
    });

    fireEvent.scroll(scrollContainer);

    const jumpButton = await screen.findByRole("button", {
      name: "Jump to latest",
    });

    fireEvent.click(jumpButton);

    await waitFor(() => {
      expect(scrollContainer.scrollTop).toBe(400);
    });
    expect(
      screen.queryByRole("button", { name: "Jump to latest" }),
    ).toBeNull();
  });
});
