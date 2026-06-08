import { useEffect, useRef, useState } from "react";

import { OperationsWorkspace } from "@/web/components/app/OperationsWorkspace";
import { TopBar } from "@/web/components/app/TopBar";
import { SidebarProvider } from "@/web/components/ui/sidebar";
import {
  appendProgressSeparatorToTranscript,
  appendRawLogEntries,
  appendRunEventsToTranscript,
  appendSummarySeparatorToTranscript,
  INITIAL_RUNTIME_STREAM_STATE,
  parseSseData,
  type GoalChangedEvent,
  type LogsEvent,
  type RunEventsEvent,
  type RunProgressEvent,
  type RunSummaryDetails,
  type RunSummaryEvent,
  type RuntimeStreamState,
  type StatusEvent,
} from "@/web/events/runtimeStream";
import type { RepositorySelectionResponse } from "@/web/api/responses";
import type { RepositorySelectionState } from "@/web/repository/repositorySelection";
import {
  isRunnerStatus,
  type RunnerStatus,
} from "@/web/runner/statuses";

const RUN_COMMAND_ACTIONS_ID = "run-command-actions";

export function App() {
  const [repositorySelection, setRepositorySelection] =
    useState<RepositorySelectionState>({
      status: "loading",
      repositoryPath: null,
    });
  const [runnerStatus, setRunnerStatus] = useState<RunnerStatus>("idle");
  const [goalRefreshToken, setGoalRefreshToken] = useState(0);
  const [runtimeStream, setRuntimeStream] = useState<RuntimeStreamState>(
    INITIAL_RUNTIME_STREAM_STATE,
  );
  const selectedRepositoryPathRef = useRef<string | null>(null);

  useEffect(() => {
    selectedRepositoryPathRef.current =
      repositorySelection.status === "ready"
        ? repositorySelection.repositoryPath
        : null;
  }, [repositorySelection]);

  useEffect(() => {
    const abortController = new AbortController();

    async function loadRepositorySelection() {
      try {
        const response = await fetch("/api/repository/selection", {
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error("Failed to load repository selection.");
        }

        const selection = (await response.json()) as RepositorySelectionResponse;

        setRepositorySelection({
          status: "ready",
          repositoryPath: selection.repositoryPath,
        });
      } catch {
        if (abortController.signal.aborted) {
          return;
        }

        setRepositorySelection({
          status: "error",
          repositoryPath: null,
        });
      }
    }

    void loadRepositorySelection();

    return () => {
      abortController.abort();
    };
  }, []);

  useEffect(() => {
    const eventSource = new EventSource("/api/events");

    setRuntimeStream((currentStream) => ({
      ...currentStream,
      connectionStatus: "connecting",
    }));

    function requestGoalRefresh(): void {
      setGoalRefreshToken((currentToken) => currentToken + 1);
    }

    function handleStatus(event: MessageEvent<string>): void {
      const statusEvent = parseSseData<StatusEvent>(event);

      if (!statusEvent || !isRunnerStatus(statusEvent.status)) {
        return;
      }

      setRunnerStatus(statusEvent.status);
      setRuntimeStream((currentStream) => ({
        ...currentStream,
        connectionStatus: "open",
      }));
      setRepositorySelection({
        status: "ready",
        repositoryPath: statusEvent.selectedRepositoryPath,
      });
    }

    function handleLogs(event: MessageEvent<string>): void {
      const logsEvent = parseSseData<LogsEvent>(event);

      if (!logsEvent || !Array.isArray(logsEvent.entries)) {
        return;
      }

      setRuntimeStream((currentStream) => ({
        ...currentStream,
        rawLogs: appendRawLogEntries(currentStream.rawLogs, logsEvent.entries),
      }));
    }

    function handleRunEvents(event: MessageEvent<string>): void {
      const runEventsEvent = parseSseData<RunEventsEvent>(event);

      if (!runEventsEvent || !Array.isArray(runEventsEvent.entries)) {
        return;
      }

      setRuntimeStream((currentStream) => ({
        ...currentStream,
        logs: appendRunEventsToTranscript(
          currentStream.logs,
          runEventsEvent.entries,
        ),
      }));
    }

    function handleProgress(event: MessageEvent<string>): void {
      const progress = parseSseData<RunProgressEvent>(event);

      if (
        !progress ||
        typeof progress.currentRun !== "number" ||
        (progress.totalRuns !== null && typeof progress.totalRuns !== "number")
      ) {
        return;
      }

      setRuntimeStream((currentStream) => ({
        ...currentStream,
        logs: appendProgressSeparatorToTranscript(currentStream.logs, progress),
        progress,
      }));
    }

    function handleSummary(event: MessageEvent<string>): void {
      const summary = parseSseData<RunSummaryEvent>(event);

      setRuntimeStream((currentStream) => ({
        ...currentStream,
        logs: appendSummarySeparatorToTranscript(
          currentStream.logs,
          summary,
          currentStream.progress,
        ),
        latestSummary: summary,
      }));

      if (summary?.status === "complete" || summary?.status === "blocked") {
        requestGoalRefresh();
      }
    }

    function handleRunDetails(event: MessageEvent<string>): void {
      const runDetails = parseSseData<RunSummaryDetails>(event);

      if (!runDetails) {
        return;
      }

      setRuntimeStream((currentStream) => ({
        ...currentStream,
        runDetails,
      }));
    }

    function handleGoalChanged(event: MessageEvent<string>): void {
      const goalChanged = parseSseData<GoalChangedEvent>(event);

      if (
        goalChanged?.repositoryPath &&
        goalChanged.repositoryPath === selectedRepositoryPathRef.current
      ) {
        requestGoalRefresh();
      }
    }

    function handleError(): void {
      setRuntimeStream((currentStream) => ({
        ...currentStream,
        connectionStatus: "error",
      }));
    }

    eventSource.addEventListener("status", handleStatus);
    eventSource.addEventListener("logs", handleLogs);
    eventSource.addEventListener("runEvents", handleRunEvents);
    eventSource.addEventListener("progress", handleProgress);
    eventSource.addEventListener("summary", handleSummary);
    eventSource.addEventListener("runDetails", handleRunDetails);
    eventSource.addEventListener("goalChanged", handleGoalChanged);
    eventSource.addEventListener("error", handleError);

    return () => {
      eventSource.removeEventListener("status", handleStatus);
      eventSource.removeEventListener("logs", handleLogs);
      eventSource.removeEventListener("runEvents", handleRunEvents);
      eventSource.removeEventListener("progress", handleProgress);
      eventSource.removeEventListener("summary", handleSummary);
      eventSource.removeEventListener("runDetails", handleRunDetails);
      eventSource.removeEventListener("goalChanged", handleGoalChanged);
      eventSource.removeEventListener("error", handleError);
      eventSource.close();
    };
  }, []);

  return (
    <SidebarProvider className="h-dvh min-h-0 flex-col overflow-hidden bg-zinc-50 text-zinc-950">
      <TopBar
        actionSlotId={RUN_COMMAND_ACTIONS_ID}
        repositorySelection={repositorySelection}
        status={runnerStatus}
      />
      <div className="flex min-h-0 w-full flex-1">
        <OperationsWorkspace
          commandActionsTargetId={RUN_COMMAND_ACTIONS_ID}
          goalRefreshToken={goalRefreshToken}
          onRepositorySelected={(repositoryPath) => {
            setRepositorySelection({
              status: "ready",
              repositoryPath,
            });
          }}
          onRunnerStatusChange={setRunnerStatus}
          repositorySelection={repositorySelection}
          runnerStatus={runnerStatus}
          runtimeStream={runtimeStream}
        />
      </div>
    </SidebarProvider>
  );
}
