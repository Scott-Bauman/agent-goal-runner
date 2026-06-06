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

  it("omits model and reasoning effort args when CLI defaults are selected", () => {
    const command = getCodexExecSpawnCommand("continue", {
      model: null,
      reasoningEffort: null,
    });

    expect(command.args.slice(-2)).toEqual(["exec", "continue"]);
  });

  it("places the selected model before the prompt", () => {
    const command = getCodexExecSpawnCommand("continue", {
      model: "gpt-5.4-mini",
      reasoningEffort: null,
    });

    expect(command.args.slice(-4)).toEqual([
      "exec",
      "--model",
      "gpt-5.4-mini",
      "continue",
    ]);
  });

  it("places the selected reasoning effort before the prompt", () => {
    const command = getCodexExecSpawnCommand("continue", {
      model: null,
      reasoningEffort: "high",
    });

    expect(command.args.slice(-4)).toEqual([
      "exec",
      "-c",
      "model_reasoning_effort=high",
      "continue",
    ]);
  });

  it("places model before reasoning effort when both are selected", () => {
    const command = getCodexExecSpawnCommand("continue", {
      model: "gpt-5.5",
      reasoningEffort: "xhigh",
    });

    expect(command.args.slice(-6)).toEqual([
      "exec",
      "--model",
      "gpt-5.5",
      "-c",
      "model_reasoning_effort=xhigh",
      "continue",
    ]);
  });
});
