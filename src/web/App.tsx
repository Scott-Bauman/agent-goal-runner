import { useEffect, useState } from "react";
import { FileText } from "lucide-react";

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

const statusLabels: Record<RunnerStatus, string> = {
  idle: "Idle",
  running: "Running",
  stopping: "Stopping",
  complete: "Complete",
  blocked: "Blocked",
  failed: "Failed",
  stopped: "Stopped",
};

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
        <span className="inline-flex h-7 w-fit shrink-0 items-center rounded-md border border-zinc-200 bg-zinc-50 px-2.5 text-xs font-medium text-zinc-700">
          {statusLabels[status]}
        </span>
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
    <section
      aria-labelledby="goal-document-title"
      className="flex min-h-[32rem] min-w-0 flex-col rounded-lg border border-zinc-200 bg-white shadow-sm"
    >
      <div className="flex min-h-14 items-center justify-between gap-3 border-b border-zinc-200 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <FileText
            aria-hidden="true"
            className="h-4 w-4 shrink-0 text-zinc-500"
            strokeWidth={2}
          />
          <h2
            id="goal-document-title"
            className="truncate text-sm font-semibold text-zinc-950"
          >
            goal.md
          </h2>
        </div>
        <span className="shrink-0 text-xs font-medium text-zinc-500">
          Rendered document
        </span>
      </div>
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <p className="max-w-sm text-center text-sm leading-6 text-zinc-500">
          {panelMessage}
        </p>
      </div>
    </section>
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
        <GoalDocumentPanel repositorySelection={repositorySelection} />
      </div>
    </main>
  );
}
