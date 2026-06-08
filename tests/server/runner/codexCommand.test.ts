import { describe, expect, it } from "vitest";

import { getCodexExecSpawnCommand } from "../../../src/server/runner/codexCommand";

function getExecArgs(args: string[]): string[] {
  const execIndex = args.indexOf("exec");

  if (execIndex < 0) {
    return args;
  }

  return args.slice(execIndex);
}

describe("Codex command resolution", () => {
  it("builds a codex exec command for the provided prompt", () => {
    const command = getCodexExecSpawnCommand("Use goal.md as the source of truth.");

    expect(command.command.length).toBeGreaterThan(0);
    expect(getExecArgs(command.args)).toEqual([
      "exec",
      "--json",
      "Use goal.md as the source of truth.",
    ]);
  });

  it("omits model and reasoning effort args when CLI defaults are selected", () => {
    const command = getCodexExecSpawnCommand("continue", {
      model: null,
      reasoningEffort: null,
    });

    expect(getExecArgs(command.args)).toEqual(["exec", "--json", "continue"]);
  });

  it("captures the last assistant message when an output path is provided", () => {
    const command = getCodexExecSpawnCommand("continue", {
      model: null,
      outputLastMessagePath: "C:\\tmp\\last-message.txt",
      reasoningEffort: null,
    });

    expect(getExecArgs(command.args)).toEqual([
      "exec",
      "--json",
      "--output-last-message",
      "C:\\tmp\\last-message.txt",
      "continue",
    ]);
  });

  it("places the selected model before the prompt", () => {
    const command = getCodexExecSpawnCommand("continue", {
      model: "gpt-5.4-mini",
      reasoningEffort: null,
    });

    expect(getExecArgs(command.args)).toEqual([
      "exec",
      "--json",
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

    expect(getExecArgs(command.args)).toEqual([
      "exec",
      "--json",
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

    expect(getExecArgs(command.args)).toEqual([
      "exec",
      "--json",
      "--model",
      "gpt-5.5",
      "-c",
      "model_reasoning_effort=xhigh",
      "continue",
    ]);
  });
});
