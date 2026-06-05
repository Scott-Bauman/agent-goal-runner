import { describe, expect, it } from "vitest";

import { getCodexExecSpawnCommand } from "../../../src/server/runner/codexCommand";

describe("Codex command resolution", () => {
  it("builds a codex exec command for the provided prompt", () => {
    const command = getCodexExecSpawnCommand("Use goal.md as the source of truth.");

    expect(command.command.length).toBeGreaterThan(0);
    expect(command.args.slice(-2)).toEqual([
      "exec",
      "Use goal.md as the source of truth.",
    ]);
  });
});
