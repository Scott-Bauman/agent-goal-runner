import { existsSync } from "node:fs";
import path from "node:path";

import type { CodexModel, CodexReasoningEffort } from "./codexOptions.js";
import type { SpawnCommand } from "../shared/process.js";

export type CodexExecOptions = {
  model: CodexModel | null;
  reasoningEffort: CodexReasoningEffort | null;
};

function getCodexExecArgs(
  prompt: string,
  options: CodexExecOptions = {
    model: null,
    reasoningEffort: null,
  },
): string[] {
  const args = ["exec"];

  if (options.model) {
    args.push("--model", options.model);
  }

  if (options.reasoningEffort) {
    args.push("-c", `model_reasoning_effort=${options.reasoningEffort}`);
  }

  args.push(prompt);

  return args;
}

export function getCodexExecSpawnCommand(
  prompt: string,
  options?: CodexExecOptions,
): SpawnCommand {
  const execArgs = getCodexExecArgs(prompt, options);

  if (process.platform !== "win32") {
    return {
      command: "codex",
      args: execArgs,
    };
  }

  for (const pathEntry of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!pathEntry) {
      continue;
    }

    const codexEntrypoint = path.join(
      pathEntry,
      "node_modules",
      "@openai",
      "codex",
      "bin",
      "codex.js",
    );

    if (existsSync(codexEntrypoint)) {
      return {
        command: process.execPath,
        args: [codexEntrypoint, ...execArgs],
      };
    }
  }

  return {
    command: "codex",
    args: execArgs,
  };
}
