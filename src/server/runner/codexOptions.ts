export const CODEX_MODELS = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-5.3-codex",
] as const;

export const CODEX_REASONING_EFFORTS = ["low", "medium", "high", "xhigh"] as const;

export type CodexModel = (typeof CODEX_MODELS)[number];
export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number];
