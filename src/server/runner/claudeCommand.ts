import type { SpawnCommand } from "../shared/process.js";
import type { ClaudeEffort, ClaudeModel } from "./claudeOptions.js";

export type ClaudePrintOptions = {
  model: ClaudeModel | null;
  effort: ClaudeEffort | null;
};

export function getClaudePrintSpawnCommand(
  prompt: string,
  options: ClaudePrintOptions = {
    model: null,
    effort: null,
  },
): SpawnCommand {
  const args = ["-p", prompt];

  if (options.model) {
    args.push("--model", options.model);
  }

  if (options.effort) {
    args.push("--effort", options.effort);
  }

  return {
    command: "claude",
    args,
  };
}
