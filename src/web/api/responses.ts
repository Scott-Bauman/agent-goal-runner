import type { RunnerStatus } from "@/web/runner/statuses";
import type { CodexModel, CodexReasoningEffort } from "@/web/runner/codexOptions";

export type RepositorySelectionResponse = {
  repositoryPath: string | null;
};

export type RepositoryBrowseResponse = RepositorySelectionResponse & {
  cancelled: boolean;
};

export type RepositoryBranchesResponse = {
  currentBranch: string | null;
  branches: string[];
  workingTreeStatus: "clean" | "changes" | "unknown";
};

export type RepositoryBranchSwitchRequest = {
  branch: string;
};

export type RepositoryBranchCreateRequest = {
  name: string;
};

export type RepositoryBranchMergeRequest = {
  branch: string;
};

export type RepositoryBranchDeleteRequest = {
  branch: string;
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
  review: {
    enabled: boolean;
    intervalCommits: number;
    prompt: string;
    model: CodexModel | null;
    reasoningEffort: CodexReasoningEffort | null;
  };
};

export type RunStopResponse = {
  status: RunnerStatus;
};
