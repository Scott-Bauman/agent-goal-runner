import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { SpawnCommand } from "../shared/process.js";
import type { ClaudeModel } from "./claudeOptions.js";

export type ClaudePrintOptions = {
  model: ClaudeModel | null;
};

export type ClaudeStreamJsonOptions = {
  model: ClaudeModel | null;
};

export function getClaudePrintSpawnCommand(
  prompt: string,
  options: ClaudePrintOptions = {
    model: null,
  },
): SpawnCommand {
  const args = ["-p", prompt];

  if (options.model) {
    args.push("--model", options.model);
  }

  return resolveClaudeCommand(args);
}

export function getClaudeStreamJsonSpawnCommand(
  prompt: string,
  options: ClaudeStreamJsonOptions = {
    model: null,
  },
): SpawnCommand {
  const args = [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
  ];

  if (options.model) {
    args.push("--model", options.model);
  }

  return resolveClaudeCommand(args);
}

function resolveClaudeCommand(args: string[]): SpawnCommand {
  if (process.platform !== "win32") {
    return {
      command: "claude",
      args,
    };
  }

  for (const pathEntry of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!pathEntry) {
      continue;
    }

    const claudePackageDirectory = path.join(
      pathEntry,
      "node_modules",
      "@anthropic-ai",
      "claude-code",
    );
    const claudeEntrypoint = getPackageBinEntrypoint(
      claudePackageDirectory,
      "claude",
    );

    if (claudeEntrypoint) {
      return {
        command: process.execPath,
        args: [claudeEntrypoint, ...args],
      };
    }
  }

  return {
    command: "claude",
    args,
  };
}

function getPackageBinEntrypoint(
  packageDirectory: string,
  binName: string,
): string | null {
  const packageJsonPath = path.join(packageDirectory, "package.json");

  if (!existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      bin?: Record<string, string> | string;
    };
    const binPath =
      typeof packageJson.bin === "string"
        ? packageJson.bin
        : packageJson.bin?.[binName];

    if (!binPath) {
      return null;
    }

    const entrypoint = path.resolve(packageDirectory, binPath);

    return existsSync(entrypoint) ? entrypoint : null;
  } catch {
    return null;
  }
}
