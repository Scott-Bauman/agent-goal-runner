import { describe, expect, it } from "vitest";

import {
  ACTIVE_RUN_STATUSES,
  RUNNER_STATUSES,
} from "../../../src/server/runner/statuses";

describe("runner statuses", () => {
  it("keeps the public status list and active status set in sync", () => {
    expect(RUNNER_STATUSES).toEqual([
      "idle",
      "running",
      "stopping",
      "complete",
      "blocked",
      "failed",
      "stopped",
    ]);
    expect([...ACTIVE_RUN_STATUSES]).toEqual(["running", "stopping"]);
  });
});
