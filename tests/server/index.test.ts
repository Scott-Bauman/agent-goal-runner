import { describe, expect, it } from "vitest";

import {
  RUNNER_STATUSES,
  buildServer,
  detectGoalStopMarker,
  getCodexExecSpawnCommand,
} from "../../src/server/index";

describe("server public API", () => {
  it("exports the public backend entrypoints from src/server/index", () => {
    expect(typeof buildServer).toBe("function");
    expect(detectGoalStopMarker("GOAL_COMPLETE")).toBe("GOAL_COMPLETE");
    expect(getCodexExecSpawnCommand("continue").args).toContain("continue");
    expect(RUNNER_STATUSES).toEqual([
      "idle",
      "running",
      "stopping",
      "complete",
      "blocked",
      "failed",
      "stopped",
    ]);
  });
});
