import type { BadgeProps } from "@/web/components/ui/badge";

export type RunnerStatus =
  | "idle"
  | "running"
  | "stopping"
  | "complete"
  | "blocked"
  | "failed"
  | "stopped";

export type BadgeVariant = NonNullable<BadgeProps["variant"]>;

export const statusBadgeConfig: Record<
  RunnerStatus,
  {
    label: string;
    variant: BadgeVariant;
  }
> = {
  idle: {
    label: "Idle",
    variant: "secondary",
  },
  running: {
    label: "Running",
    variant: "secondary",
  },
  stopping: {
    label: "Stopping",
    variant: "outline",
  },
  complete: {
    label: "Complete",
    variant: "success",
  },
  blocked: {
    label: "Blocked",
    variant: "destructive",
  },
  failed: {
    label: "Failed",
    variant: "destructive",
  },
  stopped: {
    label: "Stopped",
    variant: "outline",
  },
};

const RUNNER_ACTIVE_STATUSES = new Set<RunnerStatus>(["running", "stopping"]);
const RUNNER_STATUSES = new Set<RunnerStatus>([
  "idle",
  "running",
  "stopping",
  "complete",
  "blocked",
  "failed",
  "stopped",
]);

export function isActiveRunnerStatus(status: RunnerStatus): boolean {
  return RUNNER_ACTIVE_STATUSES.has(status);
}

export function isRunnerStatus(value: unknown): value is RunnerStatus {
  return typeof value === "string" && RUNNER_STATUSES.has(value as RunnerStatus);
}
