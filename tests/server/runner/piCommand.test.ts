import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  getPiJsonSpawnCommand,
  getPiPrintSpawnCommand,
} from "../../../src/server/runner/piCommand";

describe("Pi command resolution", () => {
  it("builds a pi print fallback command for the provided prompt", () => {
    expect(getPiPrintSpawnCommand("Use goal.md.")).toEqual({
      command: "pi",
      args: ["-p", "Use goal.md."],
    });
  });

  it("adds the selected model to the print fallback command", () => {
    expect(
      getPiPrintSpawnCommand("continue", {
        model: "llama-local",
      }),
    ).toEqual({
      command: "pi",
      args: ["-p", "continue", "--model", "llama-local"],
    });
  });

  it("builds a pi JSON command for the provided prompt", () => {
    expect(getPiJsonSpawnCommand("Use goal.md.")).toEqual({
      command: "pi",
      args: ["--mode", "json", "Use goal.md."],
    });
  });

  it("adds the selected model to the JSON command before the prompt", () => {
    expect(
      getPiJsonSpawnCommand("continue", {
        model: "llama-local",
      }),
    ).toEqual({
      command: "pi",
      args: ["--mode", "json", "--model", "llama-local", "continue"],
    });
  });

  it("uses the npm package entrypoint for print fallback on Windows when available", () => {
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

  it("uses the npm package entrypoint for JSON mode on Windows when available", () => {
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

      expect(getPiJsonSpawnCommand("continue")).toEqual({
        command: process.execPath,
        args: [entrypoint, "--mode", "json", "continue"],
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
