import { Badge } from "@/web/components/ui/badge";
import {
  statusBadgeConfig,
  type RunnerStatus,
} from "@/web/runner/statuses";

export function RunnerStatusBadge({ status }: { status: RunnerStatus }) {
  const config = statusBadgeConfig[status];

  return (
    <Badge
      aria-label={`Runner status: ${config.label}`}
      className="h-7 w-fit shrink-0"
      role="status"
      variant={config.variant}
    >
      {config.label}
    </Badge>
  );
}
