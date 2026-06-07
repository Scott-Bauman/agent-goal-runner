import { Badge } from "@/web/components/ui/badge";
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
      className={cn("h-7 w-fit shrink-0", className)}
      role="status"
      variant={config.variant}
    >
      {config.label}
    </Badge>
  );
}
