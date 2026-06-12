import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { getPiPrintSpawnCommand } from "../../../src/server/runner/piCommand";

describe("Pi command resolution", () => {
  it("builds a pi print command for the provided prompt", () => {
    expect(getPiPrintSpawnCommand("Use goal.md.")).toEqual({
      command: "pi",
      args: ["-p", "Use goal.md."],
    });
  });

  it("adds the selected model after the prompt", () => {
    expect(
      getPiPrintSpawnCommand("continue", {
        model: "llama-local",
      }),
    ).toEqual({
      command: "pi",
      args: ["-p", "continue", "--model", "llama-local"],
    });
  });

  it("uses the npm package entrypoint on Windows when available", () => {
    const originalPath = process.env.PATH;
    const originalPlatform = process.platform;
    const tempPathEntry = mkdtempSync(path.join(tmpdir(), "pi-command-"));
    const packageDirectory = path.join(tempPathEntry, "node_modules", "@withpi", "pi");
    const entrypoint = path.join(packageDirectory, "cli.js");

    try {
      mkdirSync(packageDirectory, {
        recursive: true,
      });
      writeFileSync(
        path.join(packageDirectory, "package.json"),
        JSON.stringify({
          bin: {
            pi: "cli.js",
          },
        }),
      );
      writeFileSync(entrypoint, "");
      Object.defineProperty(process, "platform", {
        configurable: true,
        value: "win32",
      });
      process.env.PATH = tempPathEntry;

      expect(getPiPrintSpawnCommand("continue")).toEqual({
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
