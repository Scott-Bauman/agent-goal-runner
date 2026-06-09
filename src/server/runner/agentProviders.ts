export const AGENT_PROVIDERS = ["codex", "claude"] as const;

export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

export const DEFAULT_AGENT_PROVIDER: AgentProvider = "codex";

export function getAgentProviderLabel(provider: AgentProvider): string {
  return provider === "claude" ? "Claude" : "Codex";
}

export function getAgentRunLabel(provider: AgentProvider): string {
  return `${getAgentProviderLabel(provider)} run`;
}
