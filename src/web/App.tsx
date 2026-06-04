import { useEffect, useState } from "react";
import { Activity, FileText, Play, Settings2, Square, Terminal } from "lucide-react";

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

function getRepositoryLabel(repositorySelection: RepositorySelectionState) {
  return repositorySelection.status === "loading"
    ? "Loading repository..."
    : repositorySelection.status === "error"
      ? "Repository unavailable"
      : (repositorySelection.repositoryPath ?? "No repository selected");
}

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
  const selectedRepositoryLabel = getRepositoryLabel(repositorySelection);

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

function ControlsPanel({
  repositorySelection,
}: {
  repositorySelection: RepositorySelectionState;
}) {
  const selectedRepositoryLabel = getRepositoryLabel(repositorySelection);

  return (
    <Card
      aria-labelledby="controls-panel-title"
      role="region"
      className="flex min-w-0 flex-col rounded-lg lg:min-h-[calc(100vh-8rem)]"
    >
      <CardHeader className="flex min-h-14 flex-row items-center justify-between gap-3 border-b px-4 py-0">
        <div className="flex min-w-0 items-center gap-2">
          <Settings2
            aria-hidden="true"
            className="h-4 w-4 shrink-0 text-muted-foreground"
            strokeWidth={2}
          />
          <CardTitle
            id="controls-panel-title"
            className="truncate text-sm"
          >
            Controls
          </CardTitle>
        </div>
        <CardDescription className="shrink-0 text-xs font-medium">
          Run setup
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4 px-4 py-4">
        <div className="space-y-2">
          <label
            className="text-xs font-medium text-zinc-700"
            htmlFor="repository-path"
          >
            Repository
          </label>
          <input
            className="h-9 w-full rounded-md border border-input bg-muted px-3 font-mono text-xs text-muted-foreground"
            disabled
            id="repository-path"
            readOnly
            title={selectedRepositoryLabel}
            value={selectedRepositoryLabel}
          />
        </div>

        <div className="space-y-2">
          <label
            className="text-xs font-medium text-zinc-700"
            htmlFor="repeat-prompt"
          >
            Repeat prompt
          </label>
          <textarea
            className="min-h-28 w-full resize-none rounded-md border border-input bg-muted px-3 py-2 text-sm leading-5 text-muted-foreground"
            disabled
            id="repeat-prompt"
            placeholder="Use goal.md as the source of truth."
            readOnly
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <label
              className="text-xs font-medium text-zinc-700"
              htmlFor="run-count"
            >
              Runs
            </label>
            <input
              className="h-9 w-full rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground"
              disabled
              id="run-count"
              min={1}
              readOnly
              type="number"
              value={1}
            />
          </div>
          <div className="space-y-2">
            <label
              className="text-xs font-medium text-zinc-700"
              htmlFor="auto-commit"
            >
              Auto-commit
            </label>
            <div className="flex h-9 items-center rounded-md border border-input bg-muted px-3">
              <input
                className="h-4 w-4"
                disabled
                id="auto-commit"
                type="checkbox"
              />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <label
            className="text-xs font-medium text-zinc-700"
            htmlFor="verification-command"
          >
            Verification
          </label>
          <input
            className="h-9 w-full rounded-md border border-input bg-muted px-3 font-mono text-xs text-muted-foreground"
            disabled
            id="verification-command"
            placeholder="npm test"
            readOnly
          />
        </div>

        <div className="mt-auto grid grid-cols-2 gap-3 pt-2">
          <button
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground opacity-50"
            disabled
            type="button"
          >
            <Play
              aria-hidden="true"
              className="h-4 w-4"
              strokeWidth={2}
            />
            Start
          </button>
          <button
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium text-muted-foreground opacity-50"
            disabled
            type="button"
          >
            <Square
              aria-hidden="true"
              className="h-4 w-4"
              strokeWidth={2}
            />
            Stop
          </button>
        </div>
      </CardContent>
    </Card>
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

function LogsSummaryPanel() {
  return (
    <Card
      aria-labelledby="logs-summary-title"
      role="region"
      className="flex min-h-64 min-w-0 flex-col rounded-lg"
    >
      <CardHeader className="flex min-h-14 flex-row items-center justify-between gap-3 border-b px-4 py-0">
        <div className="flex min-w-0 items-center gap-2">
          <Terminal
            aria-hidden="true"
            className="h-4 w-4 shrink-0 text-muted-foreground"
            strokeWidth={2}
          />
          <CardTitle
            id="logs-summary-title"
            className="truncate text-sm"
          >
            Logs
          </CardTitle>
        </div>
        <CardDescription className="shrink-0 text-xs font-medium">
          Latest run
        </CardDescription>
      </CardHeader>
      <CardContent className="grid flex-1 gap-0 p-0 md:grid-cols-[minmax(0,1fr)_18rem]">
        <section
          aria-labelledby="live-logs-title"
          className="flex min-h-48 min-w-0 flex-col border-b md:border-b-0 md:border-r"
        >
          <div className="flex h-11 items-center gap-2 border-b px-4">
            <Terminal
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-muted-foreground"
              strokeWidth={2}
            />
            <h2
              id="live-logs-title"
              className="truncate text-xs font-medium text-zinc-700"
            >
              Live logs
            </h2>
          </div>
          <div className="flex flex-1 items-center justify-center bg-zinc-950 px-4 py-8">
            <p className="max-w-sm text-center font-mono text-xs leading-5 text-zinc-400">
              Run output will stream here when a Codex loop starts.
            </p>
          </div>
        </section>

        <section
          aria-labelledby="latest-summary-title"
          className="flex min-h-48 min-w-0 flex-col"
        >
          <div className="flex h-11 items-center gap-2 border-b px-4">
            <Activity
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-muted-foreground"
              strokeWidth={2}
            />
            <h2
              id="latest-summary-title"
              className="truncate text-xs font-medium text-zinc-700"
            >
              Latest summary
            </h2>
          </div>
          <dl className="grid flex-1 content-start gap-3 px-4 py-4 text-xs">
            <div className="grid gap-1">
              <dt className="font-medium text-zinc-500">Status</dt>
              <dd className="text-sm font-medium text-zinc-800">Idle</dd>
            </div>
            <div className="grid gap-1">
              <dt className="font-medium text-zinc-500">Progress</dt>
              <dd className="text-sm font-medium text-zinc-800">No active run</dd>
            </div>
            <div className="grid gap-1">
              <dt className="font-medium text-zinc-500">Last event</dt>
              <dd className="leading-5 text-muted-foreground">
                Run summaries will appear here after backend events are connected.
              </dd>
            </div>
          </dl>
        </section>
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
      <aside className="min-w-0 lg:col-start-2">
        <ControlsPanel repositorySelection={repositorySelection} />
      </aside>
      <div className="min-w-0 lg:col-span-2">
        <LogsSummaryPanel />
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
