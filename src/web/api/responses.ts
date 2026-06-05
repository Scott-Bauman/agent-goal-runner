import type { RunnerStatus } from "@/web/runner/statuses";

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
};

export type RunStopResponse = {
  status: RunnerStatus;
};
