export const CLAUDE_MODELS = [
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
] as const;

export const CLAUDE_EFFORTS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ClaudeModel = (typeof CLAUDE_MODELS)[number];
export type ClaudeEffort = (typeof CLAUDE_EFFORTS)[number];
