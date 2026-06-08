import { Badge } from "@/web/components/ui/badge";
import StatusIndicator from "@/web/components/ui/status-indicator";
import {
  statusBadgeConfig,
  type RunnerStatus,
} from "@/web/runner/statuses";
import { cn } from "@/web/lib/utils";

export function RunnerStatusBadge({
  className,
  status,
}: {
  className?: string;
  status: RunnerStatus;
}) {
  const config = statusBadgeConfig[status];

  return (
    <Badge
      aria-label={`Runner status: ${config.label}`}
      className={cn("h-7 w-fit shrink-0 gap-1.5", className)}
      role="status"
      variant={config.variant}
    >
      {status === "running" ? (
        <StatusIndicator className="gap-0" size="sm" state="active" />
      ) : null}
      {config.label}
    </Badge>
  );
}
