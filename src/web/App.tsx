import { useEffect, useState } from "react";
import { FileText } from "lucide-react";

import { Badge, type BadgeProps } from "@/web/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/web/components/ui/card";

type RunnerStatus =
  | "idle"
  | "running"
  | "stopping"
  | "complete"
  | "blocked"
  | "failed"
  | "stopped";

type RepositorySelectionResponse = {
  repositoryPath: string | null;
};

type RepositorySelectionState =
  | {
      status: "loading";
      repositoryPath: null;
    }
  | {
      status: "ready";
      repositoryPath: string | null;
    }
  | {
      status: "error";
      repositoryPath: null;
    };

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

const statusBadgeConfig: Record<
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
    variant: "default",
  },
  stopping: {
    label: "Stopping",
    variant: "outline",
  },
  complete: {
    label: "Complete",
    variant: "default",
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

function RunnerStatusBadge({ status }: { status: RunnerStatus }) {
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

function TopBar({
  repositorySelection,
  status,
}: {
  repositorySelection: RepositorySelectionState;
  status: RunnerStatus;
}) {
  const selectedRepositoryLabel =
    repositorySelection.status === "loading"
      ? "Loading repository..."
      : repositorySelection.status === "error"
        ? "Repository unavailable"
        : (repositorySelection.repositoryPath ?? "No repository selected");

  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex min-h-16 max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="min-w-0">
          <h1 className="text-base font-semibold leading-6 text-zinc-950">
            codex-goal-runner
          </h1>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-zinc-500">
            <span className="shrink-0 font-medium text-zinc-600">Repository</span>
            <span
              className="min-w-0 truncate font-mono text-zinc-700"
              title={selectedRepositoryLabel}
            >
              {selectedRepositoryLabel}
            </span>
          </div>
        </div>
        <RunnerStatusBadge status={status} />
      </div>
    </header>
  );
}

function GoalDocumentPanel({
  repositorySelection,
}: {
  repositorySelection: RepositorySelectionState;
}) {
  const panelMessage =
    repositorySelection.status === "loading"
      ? "Loading repository selection..."
      : repositorySelection.status === "error"
        ? "Repository selection is unavailable."
        : repositorySelection.repositoryPath === null
          ? "Select a repository to view its goal.md."
          : "goal.md rendering will appear here.";

  return (
    <Card
      aria-labelledby="goal-document-title"
      role="region"
      className="flex min-h-[32rem] min-w-0 flex-col rounded-lg lg:min-h-[calc(100vh-8rem)]"
    >
      <CardHeader className="flex min-h-14 flex-row items-center justify-between gap-3 border-b px-4 py-0">
        <div className="flex min-w-0 items-center gap-2">
          <FileText
            aria-hidden="true"
            className="h-4 w-4 shrink-0 text-muted-foreground"
            strokeWidth={2}
          />
          <CardTitle
            id="goal-document-title"
            className="truncate text-sm"
          >
            goal.md
          </CardTitle>
        </div>
        <CardDescription className="shrink-0 text-xs font-medium">
          Rendered document
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 items-center justify-center px-4 py-10">
        <p className="max-w-sm text-center text-sm leading-6 text-muted-foreground">
          {panelMessage}
        </p>
      </CardContent>
    </Card>
  );
}

function OperationsWorkspace({
  repositorySelection,
}: {
  repositorySelection: RepositorySelectionState;
}) {
  return (
    <div className="grid min-h-[32rem] gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 lg:col-start-1">
        <GoalDocumentPanel repositorySelection={repositorySelection} />
      </div>
    </div>
  );
}

export function App() {
  const [repositorySelection, setRepositorySelection] =
    useState<RepositorySelectionState>({
      status: "loading",
      repositoryPath: null,
    });

  useEffect(() => {
    const abortController = new AbortController();

    async function loadRepositorySelection() {
      try {
        const response = await fetch("/api/repository/selection", {
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error("Failed to load repository selection.");
        }

        const selection = (await response.json()) as RepositorySelectionResponse;

        setRepositorySelection({
          status: "ready",
          repositoryPath: selection.repositoryPath,
        });
      } catch {
        if (abortController.signal.aborted) {
          return;
        }

        setRepositorySelection({
          status: "error",
          repositoryPath: null,
        });
      }
    }

    void loadRepositorySelection();

    return () => {
      abortController.abort();
    };
  }, []);

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <TopBar repositorySelection={repositorySelection} status="idle" />
      <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:px-6 sm:py-6">
        <OperationsWorkspace repositorySelection={repositorySelection} />
      </div>
    </main>
  );
}
