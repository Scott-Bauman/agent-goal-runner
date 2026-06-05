import type { RunnerStatus } from "../runner/statuses.js";

export type LogEntry = {
  id: number;
  stream: "system" | "stdout" | "stderr";
  message: string;
};

export type RunProgress = {
  currentRun: number;
  totalRuns: number | null;
};

export type LatestSummary = {
  status: RunnerStatus;
  message: string;
} | null;

export type RunLoopState = {
  status: RunnerStatus;
  stopRequested: boolean;
  activeProcessId: number | null;
  progress: RunProgress;
  latestSummary: LatestSummary;
};

export type RuntimeStreamState = {
  runLoop: RunLoopState;
  logs: LogEntry[];
};

export type SseEventMap = {
  status: {
    status: RunnerStatus;
    selectedRepositoryPath: string | null;
  };
  goalChanged: {
    repositoryPath: string;
    goalPath: string;
    exists: boolean;
  };
  logs: {
    entries: LogEntry[];
  };
  progress: RunProgress;
  summary: LatestSummary;
};

export type SseClient = {
  id: number;
  write: (chunk: string) => boolean;
};
