import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { getClaudePrintSpawnCommand } from "../../../src/server/runner/claudeCommand";

describe("Claude command resolution", () => {
  it("builds a claude print command for the provided prompt", () => {
    expect(getClaudePrintSpawnCommand("Use goal.md.")).toEqual({
      command: "claude",
      args: ["-p", "Use goal.md."],
    });
  });

  it("adds the selected model after the prompt", () => {
    expect(
      getClaudePrintSpawnCommand("continue", {
        model: "sonnet",
      }),
    ).toEqual({
      command: "claude",
      args: ["-p", "continue", "--model", "sonnet"],
    });
  });

  it("uses the npm package entrypoint on Windows when available", () => {
    const originalPath = process.env.PATH;
    const originalPlatform = process.platform;
    const tempPathEntry = mkdtempSync(path.join(tmpdir(), "claude-command-"));
    const packageDirectory = path.join(
      tempPathEntry,
      "node_modules",
      "@anthropic-ai",
      "claude-code",
    );
    const entrypoint = path.join(packageDirectory, "cli.js");

    try {
      mkdirSync(packageDirectory, {
        recursive: true,
      });
      writeFileSync(
        path.join(packageDirectory, "package.json"),
        JSON.stringify({
          bin: {
            claude: "cli.js",
          },
        }),
      );
      writeFileSync(entrypoint, "");
      Object.defineProperty(process, "platform", {
        configurable: true,
        value: "win32",
      });
      process.env.PATH = tempPathEntry;

      expect(getClaudePrintSpawnCommand("continue")).toEqual({
        command: process.execPath,
        args: [entrypoint, "-p", "continue"],
      });
    } finally {
      Object.defineProperty(process, "platform", {
        configurable: true,
        value: originalPlatform,
      });
      process.env.PATH = originalPath;
      rmSync(tempPathEntry, {
        force: true,
        recursive: true,
      });
    }
  });
});
