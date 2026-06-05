import { existsSync } from "node:fs";
import path from "node:path";

import type { SpawnCommand } from "../shared/process.js";

export function getCodexExecSpawnCommand(prompt: string): SpawnCommand {
  if (process.platform !== "win32") {
    return {
      command: "codex",
      args: ["exec", prompt],
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
        args: [codexEntrypoint, "exec", prompt],
      };
    }
  }

  return {
    command: "codex",
    args: ["exec", prompt],
  };
}
