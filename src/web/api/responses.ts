import type { RunnerStatus } from "@/web/runner/statuses";
import type { CodexModel, CodexReasoningEffort } from "@/web/runner/codexOptions";

export type RepositorySelectionResponse = {
  repositoryPath: string | null;
};

export type ValidationIssue = {
  path: string;
  message: string;
};

export type ApiErrorResponse = {
  code?: string;
  error?: string;
  exists?: boolean;
  issues?: ValidationIssue[];
};

export type RunStartResponse = {
  status: RunnerStatus;
  model: CodexModel | null;
  reasoningEffort: CodexReasoningEffort | null;
};

export type RunStopResponse = {
  status: RunnerStatus;
};
