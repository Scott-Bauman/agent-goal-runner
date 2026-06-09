export const AGENT_PROVIDERS = ["codex", "claude"] as const;

export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

export const DEFAULT_AGENT_PROVIDER: AgentProvider = "codex";
