import type { RunnerStatus } from "@/web/runner/statuses";
import type { AgentProvider } from "@/web/runner/agentProviders";
import type { ClaudeModel } from "@/web/runner/claudeOptions";
import type { CodexModel, CodexReasoningEffort } from "@/web/runner/codexOptions";
import type { PiModelSelection } from "@/web/runner/piOptions";

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

export type SkillInstallStatusResponse = {
  name: string;
  repoLocal: boolean;
  userGlobal: boolean;
  bundled: boolean;
  installed: boolean;
  paths: {
    repoLocal: string | null;
    userGlobal: string;
    bundled: string;
  };
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
  provider: AgentProvider;
  model: CodexModel | null;
  reasoningEffort: CodexReasoningEffort | null;
  claudeModel: ClaudeModel | null;
  piModel: PiModelSelection | null;
  review: {
    enabled: boolean;
    provider: AgentProvider;
    intervalCommits: number;
    prompt: string;
    model: CodexModel | null;
    reasoningEffort: CodexReasoningEffort | null;
    claudeModel: ClaudeModel | null;
    piModel: PiModelSelection | null;
  };
  verificationFailure:
    | {
        action: "stop";
      }
    | {
        action: "repair";
        maxRepairAttempts: number;
      };
};

export type RunStopResponse = {
  status: RunnerStatus;
};
