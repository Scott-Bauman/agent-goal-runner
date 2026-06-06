import {
  isActiveRunnerStatus,
  type RunnerStatus,
} from "@/web/runner/statuses";

export const DEFAULT_MANUAL_GOAL_MARKDOWN = `# Project Goal

## Product Goal

Describe the desired end state for this repository.

## Implementation Checklist

- [ ] Add the first implementation step.
`;

const AGENT_GOAL_PROMPT_PREFIX = [
  "Use the `goal-runner-framework` skill.",
  "Add or edit only the selected repository root `goal.md`.",
  "Preserve completed checkboxes unless explicitly requested.",
  "Do not implement project code.",
  "Do not mutate unrelated files.",
].join("\n");

export type GoalDocumentAvailability = {
  canRunGoalAction: boolean;
  isDraftReadOnly: boolean;
  isSaveDisabled: boolean;
};

export function buildAgentGoalPrompt(userPrompt: string): string {
  const trimmedUserPrompt = userPrompt.trim();

  if (!trimmedUserPrompt) {
    return AGENT_GOAL_PROMPT_PREFIX;
  }

  return `${AGENT_GOAL_PROMPT_PREFIX}\n\nUser request:\n${trimmedUserPrompt}`;
}

export function getGoalDocumentActionLabels(
  goalStatus: "missing" | "available",
): {
  agent: string;
  manual: string;
} {
  return goalStatus === "missing"
    ? {
        agent: "Agent Add",
        manual: "Add",
      }
    : {
        agent: "Agent Edit",
        manual: "Edit",
      };
}

export function getGoalDocumentAvailability({
  isSaving,
  runnerStatus,
}: {
  isSaving: boolean;
  runnerStatus: RunnerStatus;
}): GoalDocumentAvailability {
  const isRunActive = isActiveRunnerStatus(runnerStatus);

  return {
    canRunGoalAction: !isRunActive && !isSaving,
    isDraftReadOnly: isRunActive,
    isSaveDisabled: isRunActive || isSaving,
  };
}
