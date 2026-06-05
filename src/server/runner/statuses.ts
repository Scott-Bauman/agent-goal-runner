export const RUNNER_STATUSES = [
  "idle",
  "running",
  "stopping",
  "complete",
  "blocked",
  "failed",
  "stopped",
] as const;

export type RunnerStatus = (typeof RUNNER_STATUSES)[number];

export const ACTIVE_RUN_STATUSES = new Set<RunnerStatus>(["running", "stopping"]);
