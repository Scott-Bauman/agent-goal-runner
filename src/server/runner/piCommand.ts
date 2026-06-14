import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { SpawnCommand } from "../shared/process.js";

export type PiPrintOptions = {
  model: string | null;
};

export type PiJsonOptions = {
  model: string | null;
};

export function getPiPrintSpawnCommand(
  prompt: string,
  options: PiPrintOptions = {
    model: null,
  },
): SpawnCommand {
  const args = ["-p", prompt];

  if (options.model) {
    args.push("--model", options.model);
  }

  return resolvePiCommand(args);
}

export function getPiJsonSpawnCommand(
  prompt: string,
  options: PiJsonOptions = {
    model: null,
  },
): SpawnCommand {
  const args = ["--mode", "json"];

  if (options.model) {
    args.push("--model", options.model);
  }

  args.push(prompt);

  return resolvePiCommand(args);
}

function resolvePiCommand(args: string[]): SpawnCommand {
  if (process.platform !== "win32") {
    return {
      command: "pi",
      args,
    };
  }

  for (const pathEntry of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!pathEntry) {
      continue;
    }

    const packageDirectories = [
      path.join(pathEntry, "node_modules", "pi"),
      path.join(pathEntry, "node_modules", "@withpi", "pi"),
    ];

    const piEntrypoint = packageDirectories
      .map((packageDirectory) => getPackageBinEntrypoint(packageDirectory, "pi"))
      .find((entrypoint) => entrypoint !== null);

    if (piEntrypoint) {
      return {
        command: process.execPath,
        args: [piEntrypoint, ...args],
      };
    }
  }

  return {
    command: "pi",
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
