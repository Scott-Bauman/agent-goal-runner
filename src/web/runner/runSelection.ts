import type { AgentProvider } from "@/web/runner/agentProviders";
import { DEFAULT_AGENT_PROVIDER } from "@/web/runner/agentProviders";
import type { ClaudeModel } from "@/web/runner/claudeOptions";
import type { CodexModel, CodexReasoningEffort } from "@/web/runner/codexOptions";
import type { PiModelSelection } from "@/web/runner/piOptions";

export const CLI_DEFAULT_OPTION = "CLI default";

export type ModelSelection = CodexModel | typeof CLI_DEFAULT_OPTION;
export type ReasoningEffortSelection =
  | CodexReasoningEffort
  | typeof CLI_DEFAULT_OPTION;
export type ClaudeModelSelection = ClaudeModel | typeof CLI_DEFAULT_OPTION;

export type AgentRunSelection = {
  provider: AgentProvider;
  model: ModelSelection;
  reasoningEffort: ReasoningEffortSelection;
  claudeModel: ClaudeModelSelection;
  piModel: PiModelSelection;
};

export function createDefaultAgentRunSelection(): AgentRunSelection {
  return {
    provider: DEFAULT_AGENT_PROVIDER,
    model: "gpt-5.4",
    reasoningEffort: "high",
    claudeModel: CLI_DEFAULT_OPTION,
    piModel: "",
  };
}

export function toRunModel(selection: ModelSelection): CodexModel | null {
  return selection === CLI_DEFAULT_OPTION ? null : selection;
}

export function toRunReasoningEffort(
  selection: ReasoningEffortSelection,
): CodexReasoningEffort | null {
  return selection === CLI_DEFAULT_OPTION ? null : selection;
}

export function toRunClaudeModel(
  selection: ClaudeModelSelection,
): ClaudeModel | null {
  return selection === CLI_DEFAULT_OPTION ? null : selection;
}

export function toRunPiModel(
  selection: PiModelSelection,
): PiModelSelection | null {
  const trimmedSelection = selection.trim();

  return trimmedSelection.length > 0 ? trimmedSelection : null;
}
