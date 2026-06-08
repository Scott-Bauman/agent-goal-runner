import type { RunnerStatus } from "../runner/statuses.js";

export type LogEntry = {
  id: number;
  stream: "system" | "stdout" | "stderr";
  message: string;
};

export type RunEventKind =
  | "run_started"
  | "codex_session_started"
  | "command_started"
  | "command_succeeded"
  | "command_failed"
  | "file_changed"
  | "patch_applied"
  | "warning"
  | "error"
  | "final_assistant_message"
  | "run_completed";

export type RunEventPayload = {
  command?: string;
  exitCode?: number;
  files?: string[];
  kind: RunEventKind;
  message: string;
  stopReason?: string;
};

export type RunEvent = RunEventPayload & {
  id: number;
  receivedAt: number;
  runNumber: number;
  totalRuns: number | null;
};

export type RunProgress = {
  currentRun: number;
  totalRuns: number | null;
};

export type LatestSummary = {
  status: RunnerStatus;
  message: string;
} | null;

export type SkillPreflightStatus = {
  checked: boolean;
  found: string[];
  missing: string[];
};

export type RunSummaryDetails = {
  status: RunnerStatus;
  currentRun: number;
  totalRuns: number | null;
  model: string | null;
  reasoningEffort: string | null;
  tokenCount: number | null;
  changedFiles: string[];
  warningCount: number;
  errorCount: number;
  stopReason: string | null;
  lastAssistantMessage: string | null;
  skillPreflight: SkillPreflightStatus;
};

export type RunLoopState = {
  status: RunnerStatus;
  stopRequested: boolean;
  activeProcessId: number | null;
  progress: RunProgress;
  latestSummary: LatestSummary;
  details: RunSummaryDetails;
};

export type RuntimeStreamState = {
  runLoop: RunLoopState;
  logs: LogEntry[];
  runEvents: RunEvent[];
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
  runEvents: {
    entries: RunEvent[];
  };
  progress: RunProgress;
  summary: LatestSummary;
  runDetails: RunSummaryDetails;
};

export type SseClient = {
  id: number;
  write: (chunk: string) => boolean;
};
