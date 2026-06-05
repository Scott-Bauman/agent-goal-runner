import { describe, expect, it } from "vitest";

import {
  isActiveRunnerStatus,
  isRunnerStatus,
  statusBadgeConfig,
  type RunnerStatus,
} from "../../../src/web/runner/statuses";

const RUNNER_STATUSES: RunnerStatus[] = [
  "idle",
  "running",
  "stopping",
  "complete",
  "blocked",
  "failed",
  "stopped",
];

describe("frontend runner status helpers", () => {
  it("accepts every runner status", () => {
    expect(RUNNER_STATUSES.every((status) => isRunnerStatus(status))).toBe(true);
  });

  it("rejects unknown runner statuses and non-strings", () => {
    expect(isRunnerStatus("paused")).toBe(false);
    expect(isRunnerStatus(null)).toBe(false);
    expect(isRunnerStatus(1)).toBe(false);
  });

  it("identifies active runner statuses", () => {
    expect(isActiveRunnerStatus("running")).toBe(true);
    expect(isActiveRunnerStatus("stopping")).toBe(true);
    expect(isActiveRunnerStatus("idle")).toBe(false);
    expect(isActiveRunnerStatus("complete")).toBe(false);
  });

  it("defines badge configuration for every runner status", () => {
    expect(Object.keys(statusBadgeConfig).sort()).toEqual(
      [...RUNNER_STATUSES].sort(),
    );
    expect(statusBadgeConfig.running).toEqual({
      label: "Running",
      variant: "default",
    });
    expect(statusBadgeConfig.blocked).toEqual({
      label: "Blocked",
      variant: "destructive",
    });
    expect(statusBadgeConfig.stopped).toEqual({
      label: "Stopped",
      variant: "outline",
    });
  });
});
