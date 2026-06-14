// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/web/App";
import type { OperationsWorkspace } from "../../src/web/components/app/OperationsWorkspace";
import type { TopBar } from "../../src/web/components/app/TopBar";

const componentMocks = vi.hoisted(() => ({
  operationsWorkspaceProps: [] as ComponentProps<typeof OperationsWorkspace>[],
  topBarProps: [] as ComponentProps<typeof TopBar>[],
}));

vi.mock("../../src/web/components/app/TopBar", () => ({
  TopBar: (props: ComponentProps<typeof TopBar>) => {
    componentMocks.topBarProps.push(props);

    return (
      <header data-testid="top-bar">
        <span>{props.status}</span>
        <span>{props.connectionStatus}</span>
        <span>{props.repositorySelection.repositoryPath ?? "no repository"}</span>
      </header>
    );
  },
}));

vi.mock("../../src/web/components/app/OperationsWorkspace", () => ({
  OperationsWorkspace: (props: ComponentProps<typeof OperationsWorkspace>) => {
    componentMocks.operationsWorkspaceProps.push(props);

    return (
      <main data-testid="operations-workspace">
        <span>refresh:{props.goalRefreshToken}</span>
        <span>runner:{props.runnerStatus}</span>
        <span>
          repository:{props.repositorySelection.repositoryPath ?? "none"}
        </span>
        <button
          onClick={() => props.onRepositorySelected("C:\\repos\\selected")}
          type="button"
        >
          Select repository
        </button>
        <button
          onClick={() => props.onRunnerStatusChange("running")}
          type="button"
        >
          Set running
        </button>
        <button onClick={props.onClearOutput} type="button">
          Clear Output
        </button>
      </main>
    );
  },
}));

type EventSourceListener = (event: MessageEvent<string>) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];

  listeners = new Map<string, Set<EventSourceListener>>();
  close = vi.fn();
  removeEventListener = vi.fn((type: string, listener: EventSourceListener) => {
    this.listeners.get(type)?.delete(listener);
  });
  addEventListener = vi.fn((type: string, listener: EventSourceListener) => {
    const listeners = this.listeners.get(type) ?? new Set<EventSourceListener>();

    listeners.add(listener);
    this.listeners.set(type, listeners);
  });

  constructor(public readonly url: string) {
    MockEventSource.instances.push(this);
  }

  emit(type: string, data: unknown): void {
    const event = new MessageEvent<string>(type, {
      data: typeof data === "string" ? data : JSON.stringify(data),
    });

    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

const fetchMock = vi.fn();

function jsonResponse<TBody>(body: TBody, ok = true): Response {
  return {
    json: async () => body,
    ok,
  } as Response;
}

function latestTopBarProps(): ComponentProps<typeof TopBar> {
  return componentMocks.topBarProps[componentMocks.topBarProps.length - 1];
}

function latestWorkspaceProps(): ComponentProps<typeof OperationsWorkspace> {
  return componentMocks.operationsWorkspaceProps[
    componentMocks.operationsWorkspaceProps.length - 1
  ];
}

async function renderApp(
  selectionResponse: Response = jsonResponse({
    repositoryPath: "C:\\repos\\loaded",
  }),
) {
  fetchMock.mockResolvedValueOnce(selectionResponse);

  const result = render(<App />);

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/repository/selection",
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
  });

  return result;
}

describe("App", () => {
  beforeEach(() => {
    componentMocks.operationsWorkspaceProps.length = 0;
    componentMocks.topBarProps.length = 0;
    MockEventSource.instances = [];
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", MockEventSource);
    window.matchMedia = vi.fn().mockReturnValue({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("loads the selected repository and opens the runtime event stream", async () => {
    await renderApp();

    await waitFor(() => {
      expect(latestWorkspaceProps().repositorySelection).toEqual({
        repositoryPath: "C:\\repos\\loaded",
        status: "ready",
      });
    });

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe("/api/events");
    expect(latestTopBarProps()).toMatchObject({
      actionSlotId: "run-command-actions",
      connectionStatus: "connecting",
      status: "idle",
    });
    expect(screen.getByTestId("operations-workspace").textContent).toContain(
      "refresh:0",
    );
  });

  it("shows repository loading errors without replacing the SSE subscription", async () => {
    await renderApp(jsonResponse({ error: "Unavailable" }, false));

    await waitFor(() => {
      expect(latestWorkspaceProps().repositorySelection).toEqual({
        repositoryPath: null,
        status: "error",
      });
    });

    expect(MockEventSource.instances).toHaveLength(1);
  });

  it("updates status, repository, transcript state, and run details from SSE events", async () => {
    await renderApp();
    const eventSource = MockEventSource.instances[0];

    eventSource.emit("status", {
      selectedRepositoryPath: "C:\\repos\\streamed",
      status: "running",
    });
    eventSource.emit("logs", {
      entries: [{ id: 1, message: "npm test passed", stream: "stdout" }],
    });
    eventSource.emit("runEvents", {
      entries: [
        {
          id: 5,
          kind: "command_started",
          message: "npm test",
          receivedAt: 100,
          runNumber: 1,
          totalRuns: 2,
        },
      ],
    });
    eventSource.emit("progress", {
      currentRun: 1,
      totalRuns: 2,
    });
    eventSource.emit("runDetails", {
      changedFiles: ["src/web/App.tsx"],
      currentRun: 1,
      errorCount: 0,
      lastAssistantMessage: "Done",
      model: "gpt-5",
      reasoningEffort: "high",
      skillPreflight: {
        checked: true,
        found: ["skill"],
        locations: [],
        missing: [],
      },
      status: "running",
      stopReason: null,
      tokenCount: 42,
      totalRuns: 2,
      warningCount: 1,
    });

    await waitFor(() => {
      expect(latestWorkspaceProps().runnerStatus).toBe("running");
      expect(latestWorkspaceProps().repositorySelection.repositoryPath).toBe(
        "C:\\repos\\streamed",
      );
    });

    expect(latestWorkspaceProps().runtimeStream).toMatchObject({
      connectionStatus: "open",
      progress: {
        currentRun: 1,
        totalRuns: 2,
      },
      rawLogs: [{ id: 1, message: "npm test passed", stream: "stdout" }],
      runDetails: {
        changedFiles: ["src/web/App.tsx"],
        model: "gpt-5",
        status: "running",
      },
    });
    expect(latestWorkspaceProps().runtimeStream.logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "npm test",
          type: "run-event",
        }),
        expect.objectContaining({
          message: "Starting Run 1 of 2",
          type: "separator",
        }),
      ]),
    );
  });

  it("refreshes the goal only for terminal summaries and matching goal changes", async () => {
    await renderApp();
    const eventSource = MockEventSource.instances[0];

    eventSource.emit("status", {
      selectedRepositoryPath: "C:\\repos\\selected",
      status: "running",
    });

    await waitFor(() => {
      expect(latestWorkspaceProps().repositorySelection.repositoryPath).toBe(
        "C:\\repos\\selected",
      );
    });

    eventSource.emit("summary", {
      message: "Still running",
      status: "running",
    });
    eventSource.emit("goalChanged", {
      exists: true,
      goalPath: "C:\\repos\\other\\goal.md",
      repositoryPath: "C:\\repos\\other",
    });

    await waitFor(() => {
      expect(latestWorkspaceProps().goalRefreshToken).toBe(0);
    });

    eventSource.emit("summary", {
      message: "Goal complete",
      status: "complete",
    });
    eventSource.emit("goalChanged", {
      exists: true,
      goalPath: "C:\\repos\\selected\\goal.md",
      repositoryPath: "C:\\repos\\selected",
    });

    await waitFor(() => {
      expect(latestWorkspaceProps().goalRefreshToken).toBe(2);
    });
  });

  it("clears output state while preserving the stream connection state", async () => {
    await renderApp();
    const eventSource = MockEventSource.instances[0];

    eventSource.emit("status", {
      selectedRepositoryPath: "C:\\repos\\streamed",
      status: "complete",
    });
    eventSource.emit("logs", {
      entries: [{ id: 1, message: "npm test passed", stream: "stdout" }],
    });
    eventSource.emit("progress", {
      currentRun: 1,
      totalRuns: 2,
    });
    eventSource.emit("summary", {
      message: "Goal complete",
      status: "complete",
    });
    eventSource.emit("runDetails", {
      changedFiles: ["src/web/App.tsx"],
      currentRun: 1,
      errorCount: 0,
      lastAssistantMessage: "Done",
      model: "gpt-5",
      reasoningEffort: "high",
      skillPreflight: {
        checked: true,
        found: ["skill"],
        locations: [],
        missing: [],
      },
      status: "complete",
      stopReason: null,
      tokenCount: 42,
      totalRuns: 2,
      warningCount: 1,
    });

    await waitFor(() => {
      expect(latestWorkspaceProps().runtimeStream.rawLogs).toHaveLength(1);
      expect(latestWorkspaceProps().runtimeStream.latestSummary).toEqual({
        message: "Goal complete",
        status: "complete",
      });
    });

    screen.getByRole("button", { name: "Clear Output" }).click();

    await waitFor(() => {
      expect(latestWorkspaceProps().runtimeStream).toMatchObject({
        connectionStatus: "open",
        latestSummary: null,
        logs: [],
        progress: {
          currentRun: 0,
          totalRuns: null,
        },
        rawLogs: [],
        runDetails: {
          changedFiles: [],
          currentRun: 0,
          lastAssistantMessage: null,
          model: null,
          reasoningEffort: null,
          status: "idle",
          totalRuns: null,
        },
      });
    });
    expect(latestWorkspaceProps().runnerStatus).toBe("complete");
  });

  it("ignores malformed SSE data and invalid event payloads", async () => {
    await renderApp();
    const eventSource = MockEventSource.instances[0];

    eventSource.emit("status", "{not json");
    eventSource.emit("status", {
      selectedRepositoryPath: "C:\\repos\\ignored",
      status: "not-a-runner-status",
    });
    eventSource.emit("logs", {
      entries: "not logs",
    });
    eventSource.emit("progress", {
      currentRun: 1,
      totalRuns: "two",
    });

    await waitFor(() => {
      expect(latestWorkspaceProps().repositorySelection.repositoryPath).toBe(
        "C:\\repos\\loaded",
      );
    });

    expect(latestWorkspaceProps()).toMatchObject({
      runnerStatus: "idle",
      runtimeStream: {
        progress: {
          currentRun: 0,
          totalRuns: null,
        },
        rawLogs: [],
      },
    });
  });

  it("lets child panels drive selected repository and runner status state", async () => {
    await renderApp();

    screen.getByRole("button", { name: "Select repository" }).click();
    screen.getByRole("button", { name: "Set running" }).click();

    await waitFor(() => {
      expect(latestWorkspaceProps()).toMatchObject({
        repositorySelection: {
          repositoryPath: "C:\\repos\\selected",
          status: "ready",
        },
        runnerStatus: "running",
      });
    });
  });

  it("marks the stream as errored and cleans up event listeners on unmount", async () => {
    const { unmount } = await renderApp();
    const eventSource = MockEventSource.instances[0];

    eventSource.emit("error", {});

    await waitFor(() => {
      expect(latestTopBarProps().connectionStatus).toBe("error");
    });

    unmount();

    expect(eventSource.removeEventListener).toHaveBeenCalledTimes(8);
    expect(eventSource.close).toHaveBeenCalledTimes(1);
  });
});
