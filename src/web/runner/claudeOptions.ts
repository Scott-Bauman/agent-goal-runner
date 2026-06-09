export const CLAUDE_MODELS = [
  "sonnet",
  "opus",
] as const;

export type ClaudeModel = (typeof CLAUDE_MODELS)[number];
