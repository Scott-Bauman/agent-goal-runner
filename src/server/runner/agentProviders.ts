export const AGENT_PROVIDERS = ["codex", "claude", "pi"] as const;

export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

export const DEFAULT_AGENT_PROVIDER: AgentProvider = "codex";

export function getAgentProviderLabel(provider: AgentProvider): string {
  if (provider === "claude") {
    return "Claude";
  }

  if (provider === "pi") {
    return "Pi";
  }

  return "Codex";
}

export function getAgentRunLabel(provider: AgentProvider): string {
  return `${getAgentProviderLabel(provider)} run`;
}
