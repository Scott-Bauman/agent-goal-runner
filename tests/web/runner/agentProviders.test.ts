import { describe, expect, it } from "vitest";

import {
  AGENT_PROVIDERS,
  DEFAULT_AGENT_PROVIDER,
  type AgentProvider,
} from "../../../src/web/runner/agentProviders";

describe("frontend agent provider contract", () => {
  it("exposes every selectable provider", () => {
    expect([...AGENT_PROVIDERS]).toEqual(["codex", "claude", "pi"]);
  });

  it("keeps Codex as the default provider", () => {
    expect(DEFAULT_AGENT_PROVIDER satisfies AgentProvider).toBe("codex");
  });
});
