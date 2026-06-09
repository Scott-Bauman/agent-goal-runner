import type { AgentProvider } from "@/web/runner/agentProviders";
import type { ClaudeEffort, ClaudeModel } from "@/web/runner/claudeOptions";
import type { CodexModel, CodexReasoningEffort } from "@/web/runner/codexOptions";

export type ReviewRunRequest =
  | {
      enabled: false;
    }
  | {
      enabled: true;
      provider: AgentProvider;
      intervalCommits: number;
      prompt: string;
      model: CodexModel | null;
      reasoningEffort: CodexReasoningEffort | null;
      claudeModel: ClaudeModel | null;
      claudeEffort: ClaudeEffort | null;
    };

export function isReviewSettingsVisible(reviewEnabled: boolean): boolean {
  return reviewEnabled;
}

export function getAutoCommitForReview(
  reviewEnabled: boolean,
  autoCommit: boolean,
): boolean {
  return reviewEnabled || autoCommit;
}

export function createDefaultReviewPrompt(intervalCommits: number): string {
  const normalizedInterval =
    Number.isInteger(intervalCommits) && intervalCommits > 0
      ? intervalCommits
      : 3;
  const commitLabel = normalizedInterval === 1 ? "commit" : "commits";

  return `Review the last ${normalizedInterval} ${commitLabel} for bugs, regressions, and missed requirements. Fix any issues you find, then report what you changed.`;
}

export function createReviewRunRequest({
  intervalCommits,
  provider = "codex",
  model,
  prompt,
  reasoningEffort,
  claudeModel = null,
  claudeEffort = null,
  reviewEnabled,
}: {
  intervalCommits: number;
  provider?: AgentProvider;
  model: CodexModel | null;
  prompt: string;
  reasoningEffort: CodexReasoningEffort | null;
  claudeModel?: ClaudeModel | null;
  claudeEffort?: ClaudeEffort | null;
  reviewEnabled: boolean;
}): ReviewRunRequest {
  if (!reviewEnabled) {
    return {
      enabled: false,
    };
  }

  return {
    enabled: true,
    provider,
    intervalCommits,
    model: provider === "codex" ? model : null,
    prompt: preferSkillReferenceSyntax(prompt),
    reasoningEffort: provider === "codex" ? reasoningEffort : null,
    claudeModel: provider === "claude" ? claudeModel : null,
    claudeEffort: provider === "claude" ? claudeEffort : null,
  };
}

export function preferSkillReferenceSyntax(prompt: string): string {
  return prompt.replace(
    /\b(?:use|invoke|load|apply)\s+(?:the\s+)?(?:skill\s+)?([A-Za-z0-9][A-Za-z0-9_-]*)\s+skill\b/gi,
    (_match, skillName: string) => `Use $${skillName}`,
  );
}
