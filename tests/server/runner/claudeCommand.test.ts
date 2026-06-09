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
        model: "claude-sonnet-4-6",
        effort: null,
      }),
    ).toEqual({
      command: "claude",
      args: ["-p", "continue", "--model", "claude-sonnet-4-6"],
    });
  });

  it("adds the selected effort after the prompt", () => {
    expect(
      getClaudePrintSpawnCommand("continue", {
        model: null,
        effort: "max",
      }),
    ).toEqual({
      command: "claude",
      args: ["-p", "continue", "--effort", "max"],
    });
  });

  it("places model before effort when both are selected", () => {
    expect(
      getClaudePrintSpawnCommand("continue", {
        model: "claude-opus-4-8",
        effort: "xhigh",
      }),
    ).toEqual({
      command: "claude",
      args: [
        "-p",
        "continue",
        "--model",
        "claude-opus-4-8",
        "--effort",
        "xhigh",
      ],
    });
  });
});
