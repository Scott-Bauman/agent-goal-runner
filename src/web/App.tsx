import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Activity,
  AlertCircle,
  Check,
  FilePlus2,
  FileText,
  FolderOpen,
  Play,
  Settings2,
  Square,
  Terminal,
} from "lucide-react";

import { Badge, type BadgeProps } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/web/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/web/components/ui/empty";
import { Input } from "@/web/components/ui/input";
import { renderGoalMarkdown } from "@/web/markdown";
import { Textarea } from "@/web/components/ui/textarea";

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

type ValidationIssue = {
  path: string;
  message: string;
};

type ApiErrorResponse = {
  code?: string;
  error?: string;
  exists?: boolean;
  issues?: ValidationIssue[];
};

type GoalFileResponse = {
  exists?: boolean;
  goalPath: string;
  markdown: string;
  repositoryPath: string;
};

type GoalChangedEvent = {
  repositoryPath: string;
  goalPath: string;
  exists: boolean;
};

type StatusEvent = {
  status: RunnerStatus;
  selectedRepositoryPath: string | null;
};

type LogEntry = {
  id: number;
  stream: "system" | "stdout" | "stderr";
  message: string;
};

type LogsEvent = {
  entries: LogEntry[];
};

type RunProgressEvent = {
  currentRun: number;
  totalRuns: number | null;
};

type RunSummaryEvent = {
  status: RunnerStatus;
  message: string;
} | null;

type RuntimeStreamState = {
  connectionStatus: "connecting" | "open" | "error";
  logs: LogEntry[];
  progress: RunProgressEvent;
  latestSummary: RunSummaryEvent;
};

type RunStartResponse = {
  status: RunnerStatus;
};

type RunStopResponse = {
  status: RunnerStatus;
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

type RepositoryPathFormState = {
  status: "idle" | "submitting";
  error: string | null;
  issues: ValidationIssue[];
};

type RunControlFormState = {
  status: "idle" | "starting" | "stopping";
  error: string | null;
  issues: ValidationIssue[];
};

type GoalFileState =
  | {
      status: "idle" | "loading" | "available" | "missing" | "creating";
      error: null;
      goalPath: string | null;
      markdown: string | null;
      repositoryPath: string | null;
    }
  | {
      status: "error";
      error: string;
      goalPath: null;
      markdown: null;
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

const DEFAULT_REPEAT_PROMPT = [
  "Use goal.md as the source of truth.",
  "",
  "Complete the next valid unchecked item.",
].join("\n");
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
const INITIAL_RUNTIME_STREAM_STATE: RuntimeStreamState = {
  connectionStatus: "connecting",
  logs: [],
  progress: {
    currentRun: 0,
    totalRuns: null,
  },
  latestSummary: null,
};

const connectionStatusConfig: Record<
  RuntimeStreamState["connectionStatus"],
  {
    label: string;
    variant: BadgeVariant;
  }
> = {
  connecting: {
    label: "Connecting",
    variant: "outline",
  },
  open: {
    label: "Stream open",
    variant: "secondary",
  },
  error: {
    label: "Stream error",
    variant: "destructive",
  },
};

function getRepositoryLabel(repositorySelection: RepositorySelectionState) {
  return repositorySelection.status === "loading"
    ? "Loading repository..."
    : repositorySelection.status === "error"
      ? "Repository unavailable"
      : (repositorySelection.repositoryPath ?? "No repository selected");
}

function formatRepositorySelectionError(errorResponse: ApiErrorResponse): {
  error: string;
  issues: ValidationIssue[];
} {
  const issues = Array.isArray(errorResponse.issues) ? errorResponse.issues : [];

  return {
    error: errorResponse.error ?? "Failed to select repository.",
    issues,
  };
}

function formatApiError(errorResponse: ApiErrorResponse, fallback: string): {
  error: string;
  issues: ValidationIssue[];
} {
  const issues = Array.isArray(errorResponse.issues) ? errorResponse.issues : [];

  return {
    error: errorResponse.error ?? fallback,
    issues,
  };
}

function getApiErrorMessage(
  errorResponse: ApiErrorResponse,
  fallback: string,
): string {
  return errorResponse.error ?? fallback;
}

function isActiveRunnerStatus(status: RunnerStatus): boolean {
  return RUNNER_ACTIVE_STATUSES.has(status);
}

function isRunnerStatus(value: unknown): value is RunnerStatus {
  return typeof value === "string" && RUNNER_STATUSES.has(value as RunnerStatus);
}

function parseSseData<T>(event: MessageEvent<string>): T | null {
  try {
    return JSON.parse(event.data) as T;
  } catch {
    return null;
  }
}

function formatProgress(progress: RunProgressEvent): string {
  if (progress.totalRuns === null) {
    return progress.currentRun > 0 ? `Run ${progress.currentRun}` : "No active run";
  }

  if (progress.totalRuns <= 0 || progress.currentRun <= 0) {
    return "No active run";
  }

  return `Run ${progress.currentRun} of ${progress.totalRuns}`;
}

function formatLogStream(stream: LogEntry["stream"]): string {
  switch (stream) {
    case "stderr":
      return "stderr";
    case "stdout":
      return "stdout";
    case "system":
      return "system";
  }
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
  onRepositorySelected,
  onRunnerStatusChange,
  repositorySelection,
  runnerStatus,
}: {
  onRepositorySelected: (repositoryPath: string) => void;
  onRunnerStatusChange: (status: RunnerStatus) => void;
  repositorySelection: RepositorySelectionState;
  runnerStatus: RunnerStatus;
}) {
  const [repositoryPathInput, setRepositoryPathInput] = useState("");
  const [repeatPrompt, setRepeatPrompt] = useState(DEFAULT_REPEAT_PROMPT);
  const [runCount, setRunCount] = useState("1");
  const [verificationCommand, setVerificationCommand] = useState("");
  const [autoCommit, setAutoCommit] = useState(false);
  const [repositoryPathForm, setRepositoryPathForm] =
    useState<RepositoryPathFormState>({
      status: "idle",
      error: null,
      issues: [],
    });
  const [runControlForm, setRunControlForm] = useState<RunControlFormState>({
    status: "idle",
    error: null,
    issues: [],
  });
  const selectedRepositoryLabel = getRepositoryLabel(repositorySelection);
  const selectedRepositoryPath =
    repositorySelection.status === "ready"
      ? repositorySelection.repositoryPath
      : null;
  const repositoryPathErrorId = "repository-path-error";
  const repositoryPathIssuesId = "repository-path-issues";
  const runControlErrorId = "run-control-error";
  const runControlIssuesId = "run-control-issues";
  const hasRepositoryPathError =
    repositoryPathForm.error !== null || repositoryPathForm.issues.length > 0;
  const hasRunControlError =
    runControlForm.error !== null || runControlForm.issues.length > 0;
  const repositoryPathIssueMessages = repositoryPathForm.issues.map(
    (issue) =>
      issue.path === "path" ? issue.message : `${issue.path}: ${issue.message}`,
  );
  const runControlIssueMessages = runControlForm.issues.map((issue) =>
    issue.path === "request" ? issue.message : `${issue.path}: ${issue.message}`,
  );
  const repositoryPathDescribedBy = hasRepositoryPathError
    ? `${repositoryPathErrorId} ${repositoryPathIssuesId}`
    : undefined;
  const parsedRunCount = Number(runCount);
  const isRunCountValid =
    Number.isInteger(parsedRunCount) &&
    parsedRunCount >= 1 &&
    parsedRunCount <= 100;
  const isPromptValid = repeatPrompt.trim().length > 0;
  const isRunActive = isActiveRunnerStatus(runnerStatus);
  const isRunControlPending = runControlForm.status !== "idle";
  const canStartRun =
    selectedRepositoryPath !== null &&
    isPromptValid &&
    isRunCountValid &&
    !isRunActive &&
    !isRunControlPending &&
    repositoryPathForm.status !== "submitting";
  const canStopRun =
    runnerStatus === "running" &&
    !isRunControlPending &&
    repositoryPathForm.status !== "submitting";

  useEffect(() => {
    if (repositorySelection.status !== "ready") {
      return;
    }

    setRepositoryPathInput(repositorySelection.repositoryPath ?? "");
    setRunControlForm({
      status: "idle",
      error: null,
      issues: [],
    });
  }, [repositorySelection]);

  async function handleRepositorySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRepositoryPathForm({
      status: "submitting",
      error: null,
      issues: [],
    });

    try {
      const response = await fetch("/api/repository/select", {
        body: JSON.stringify({
          path: repositoryPathInput,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const responseBody = (await response.json()) as
        | RepositorySelectionResponse
        | ApiErrorResponse;

      if (!response.ok) {
        const formattedError = formatRepositorySelectionError(
          responseBody as ApiErrorResponse,
        );

        setRepositoryPathForm({
          status: "idle",
          error: formattedError.error,
          issues: formattedError.issues,
        });
        return;
      }

      const repositoryPath = (responseBody as RepositorySelectionResponse)
        .repositoryPath;

      if (!repositoryPath) {
        setRepositoryPathForm({
          status: "idle",
          error: "Repository selection response did not include a path.",
          issues: [],
        });
        return;
      }

      onRepositorySelected(repositoryPath);
      setRepositoryPathInput(repositoryPath);
      setRepositoryPathForm({
        status: "idle",
        error: null,
        issues: [],
      });
    } catch {
      setRepositoryPathForm({
        status: "idle",
        error: "Failed to select repository. Confirm the backend is running.",
        issues: [],
      });
    }
  }

  async function handleRunStart() {
    if (!selectedRepositoryPath) {
      setRunControlForm({
        status: "idle",
        error: "Select a repository before starting a run.",
        issues: [],
      });
      return;
    }

    if (!isPromptValid || !isRunCountValid || isRunActive) {
      return;
    }

    setRunControlForm({
      status: "starting",
      error: null,
      issues: [],
    });

    try {
      const response = await fetch("/api/run/start", {
        body: JSON.stringify({
          autoCommit,
          prompt: repeatPrompt,
          runCount: parsedRunCount,
          verificationCommand,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const responseBody = (await response.json()) as
        | RunStartResponse
        | ApiErrorResponse;

      if (!response.ok) {
        const formattedError = formatApiError(
          responseBody as ApiErrorResponse,
          "Failed to start run.",
        );

        setRunControlForm({
          status: "idle",
          error: formattedError.error,
          issues: formattedError.issues,
        });
        return;
      }

      onRunnerStatusChange((responseBody as RunStartResponse).status);
      setRunControlForm({
        status: "idle",
        error: null,
        issues: [],
      });
    } catch {
      setRunControlForm({
        status: "idle",
        error: "Failed to start run. Confirm the backend is running.",
        issues: [],
      });
    }
  }

  async function handleRunStop() {
    if (runnerStatus !== "running") {
      return;
    }

    setRunControlForm({
      status: "stopping",
      error: null,
      issues: [],
    });

    try {
      const response = await fetch("/api/run/stop", {
        method: "POST",
      });
      const responseBody = (await response.json()) as
        | RunStopResponse
        | ApiErrorResponse;

      if (!response.ok) {
        const formattedError = formatApiError(
          responseBody as ApiErrorResponse,
          "Failed to stop run.",
        );

        setRunControlForm({
          status: "idle",
          error: formattedError.error,
          issues: formattedError.issues,
        });
        return;
      }

      onRunnerStatusChange((responseBody as RunStopResponse).status);
      setRunControlForm({
        status: "idle",
        error: null,
        issues: [],
      });
    } catch {
      setRunControlForm({
        status: "idle",
        error: "Failed to stop run. Confirm the backend is running.",
        issues: [],
      });
    }
  }

  return (
    <Card
      aria-labelledby="controls-panel-title"
      role="region"
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg"
    >
      <CardHeader className="flex min-h-14 flex-row flex-wrap items-center justify-between gap-2 border-b px-4 py-3 sm:flex-nowrap sm:py-0">
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
        <CardDescription className="hidden min-w-0 max-w-[55%] truncate text-right text-xs font-medium sm:block sm:max-w-none">
          Run setup
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            void handleRepositorySubmit(event);
          }}
        >
          <label
            className="text-xs font-medium text-zinc-700"
            htmlFor="repository-path"
          >
            Repository
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              aria-describedby={repositoryPathDescribedBy}
              aria-invalid={hasRepositoryPathError}
              className="font-mono text-xs"
              disabled={repositoryPathForm.status === "submitting"}
              id="repository-path"
              onChange={(event) => {
                setRepositoryPathInput(event.target.value);
              }}
              placeholder="C:\\Users\\name\\repo"
              title={repositoryPathInput}
              value={repositoryPathInput}
            />
            <Button
              disabled={repositoryPathForm.status === "submitting"}
              type="submit"
              variant="outline"
            >
              <FolderOpen
                aria-hidden="true"
                data-icon="inline-start"
                strokeWidth={2}
              />
              Select
            </Button>
          </div>
          {hasRepositoryPathError ? (
            <div
              className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive"
              role="alert"
            >
              {repositoryPathForm.error ? (
                <p
                  className="font-medium"
                  id={repositoryPathErrorId}
                >
                  {repositoryPathForm.error}
                </p>
              ) : null}
              {repositoryPathIssueMessages.length > 0 ? (
                <ul
                  className="flex flex-col gap-1"
                  id={repositoryPathIssuesId}
                >
                  {repositoryPathIssueMessages.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          <div className="flex min-w-0 items-start gap-2 rounded-md border bg-muted px-3 py-2">
            <Check
              aria-hidden="true"
              className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
              strokeWidth={2}
            />
            <div className="min-w-0">
              <p className="text-xs font-medium text-zinc-700">Selected path</p>
              <p
                className="truncate font-mono text-xs leading-5 text-muted-foreground"
                title={selectedRepositoryLabel}
              >
                {selectedRepositoryLabel}
              </p>
            </div>
          </div>
        </form>

        <div className="flex flex-col gap-2">
          <label
            className="text-xs font-medium text-zinc-700"
            htmlFor="repeat-prompt"
          >
            Repeat prompt
          </label>
          <Textarea
            className="min-h-28 resize-y leading-5"
            id="repeat-prompt"
            placeholder="Use goal.md as the source of truth."
            onChange={(event) => {
              setRepeatPrompt(event.target.value);
            }}
            value={repeatPrompt}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label
              className="text-xs font-medium text-zinc-700"
              htmlFor="run-count"
            >
              Runs
            </label>
            <Input
              aria-invalid={!isRunCountValid}
              id="run-count"
              inputMode="numeric"
              max={100}
              min={1}
              onChange={(event) => {
                setRunCount(event.target.value);
              }}
              step={1}
              type="number"
              value={runCount}
            />
          </div>
          <div className="flex flex-col gap-2">
            <span
              className="text-xs font-medium text-zinc-700"
              id="auto-commit-label"
            >
              Auto-commit
            </span>
            <div className="flex h-9 items-center justify-between gap-3 rounded-md border border-input bg-muted px-3">
              <span
                className="text-xs font-medium text-muted-foreground"
                id="auto-commit-state"
              >
                {autoCommit ? "Enabled" : "Off"}
              </span>
              <button
                aria-checked={autoCommit}
                aria-describedby="auto-commit-state"
                aria-labelledby="auto-commit-label"
                className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent bg-zinc-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[state=checked]:bg-zinc-950"
                data-state={autoCommit ? "checked" : "unchecked"}
                id="auto-commit"
                onClick={() => {
                  setAutoCommit((currentAutoCommit) => !currentAutoCommit);
                }}
                role="switch"
                type="button"
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-4"
                  data-state={autoCommit ? "checked" : "unchecked"}
                />
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label
            className="text-xs font-medium text-zinc-700"
            htmlFor="verification-command"
          >
            Verification command
          </label>
          <Input
            className="font-mono text-xs"
            id="verification-command"
            placeholder="npm test"
            onChange={(event) => {
              setVerificationCommand(event.target.value);
            }}
            value={verificationCommand}
          />
        </div>

        <div className="mt-auto grid gap-3 pt-2 sm:grid-cols-2">
          <Button
            disabled={!canStartRun}
            onClick={() => {
              void handleRunStart();
            }}
            type="button"
          >
            <Play
              aria-hidden="true"
              data-icon="inline-start"
              strokeWidth={2}
            />
            {runControlForm.status === "starting" ? "Starting..." : "Start"}
          </Button>
          <Button
            disabled={!canStopRun}
            onClick={() => {
              void handleRunStop();
            }}
            type="button"
            variant="outline"
          >
            <Square
              aria-hidden="true"
              data-icon="inline-start"
              strokeWidth={2}
            />
            {runControlForm.status === "stopping" ? "Stopping..." : "Stop"}
          </Button>
        </div>
        {hasRunControlError ? (
          <div
            className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive"
            role="alert"
          >
            {runControlForm.error ? (
              <p
                className="font-medium"
                id={runControlErrorId}
              >
                {runControlForm.error}
              </p>
            ) : null}
            {runControlIssueMessages.length > 0 ? (
              <ul
                className="flex flex-col gap-1"
                id={runControlIssuesId}
              >
                {runControlIssueMessages.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function GoalDocumentPanel({
  goalRefreshToken,
  repositorySelection,
}: {
  goalRefreshToken: number;
  repositorySelection: RepositorySelectionState;
}) {
  const [goalFileState, setGoalFileState] = useState<GoalFileState>({
    status: "idle",
    error: null,
    goalPath: null,
    markdown: null,
    repositoryPath: null,
  });
  const selectedRepositoryPath =
    repositorySelection.status === "ready"
      ? repositorySelection.repositoryPath
      : null;
  const renderedGoalHtml = useMemo(
    () =>
      goalFileState.status === "available" && goalFileState.markdown !== null
        ? renderGoalMarkdown(goalFileState.markdown)
        : null,
    [goalFileState.markdown, goalFileState.status],
  );

  const loadGoalFile = useCallback(async (signal?: AbortSignal) => {
    setGoalFileState({
      status: "loading",
      error: null,
      goalPath: null,
      markdown: null,
      repositoryPath: null,
    });

    try {
      const response = await fetch("/api/goal", {
        signal,
      });
      const responseBody = (await response.json()) as
        | GoalFileResponse
        | ApiErrorResponse;

      if (response.ok) {
        const goalFile = responseBody as GoalFileResponse;

        setGoalFileState({
          status: "available",
          error: null,
          goalPath: goalFile.goalPath,
          markdown: goalFile.markdown,
          repositoryPath: goalFile.repositoryPath,
        });
        return;
      }

      const errorResponse = responseBody as ApiErrorResponse;

      if (response.status === 404 && errorResponse.code === "GOAL_MISSING") {
        setGoalFileState({
          status: "missing",
          error: null,
          goalPath: null,
          markdown: null,
          repositoryPath: null,
        });
        return;
      }

      setGoalFileState({
        status: "error",
        error: getApiErrorMessage(errorResponse, "Failed to load goal.md."),
        goalPath: null,
        markdown: null,
        repositoryPath: null,
      });
    } catch {
      if (signal?.aborted) {
        return;
      }

      setGoalFileState({
        status: "error",
        error: "Failed to load goal.md. Confirm the backend is running.",
        goalPath: null,
        markdown: null,
        repositoryPath: null,
      });
    }
  }, []);

  useEffect(() => {
    if (!selectedRepositoryPath) {
      setGoalFileState({
        status: "idle",
        error: null,
        goalPath: null,
        markdown: null,
        repositoryPath: null,
      });
      return;
    }

    const abortController = new AbortController();

    void loadGoalFile(abortController.signal);

    return () => {
      abortController.abort();
    };
  }, [goalRefreshToken, loadGoalFile, selectedRepositoryPath]);

  async function handleCreateDefaultGoal() {
    if (!selectedRepositoryPath || goalFileState.status === "creating") {
      return;
    }

    setGoalFileState({
      status: "creating",
      error: null,
      goalPath: null,
      markdown: null,
      repositoryPath: null,
    });

    try {
      const response = await fetch("/api/goal", {
        body: JSON.stringify({}),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const responseBody = (await response.json()) as
        | GoalFileResponse
        | ApiErrorResponse;

      if (response.ok) {
        const goalFile = responseBody as GoalFileResponse;

        setGoalFileState({
          status: "available",
          error: null,
          goalPath: goalFile.goalPath,
          markdown: goalFile.markdown,
          repositoryPath: goalFile.repositoryPath,
        });
        return;
      }

      const errorResponse = responseBody as ApiErrorResponse;

      if (response.status === 409 && errorResponse.code === "GOAL_EXISTS") {
        await loadGoalFile();
        return;
      }

      setGoalFileState({
        status: "error",
        error: getApiErrorMessage(
          errorResponse,
          "Failed to create default goal.md.",
        ),
        goalPath: null,
        markdown: null,
        repositoryPath: null,
      });
    } catch {
      setGoalFileState({
        status: "error",
        error: "Failed to create default goal.md. Confirm the backend is running.",
        goalPath: null,
        markdown: null,
        repositoryPath: null,
      });
    }
  }

  function renderGoalPanelContent() {
    if (repositorySelection.status === "loading") {
      return (
        <p className="max-w-sm text-center text-sm leading-6 text-muted-foreground">
          Loading repository selection...
        </p>
      );
    }

    if (repositorySelection.status === "error") {
      return (
        <p className="max-w-sm text-center text-sm leading-6 text-muted-foreground">
          Repository selection is unavailable.
        </p>
      );
    }

    if (repositorySelection.repositoryPath === null) {
      return (
        <p className="max-w-sm text-center text-sm leading-6 text-muted-foreground">
          Select a repository to view its goal.md.
        </p>
      );
    }

    if (goalFileState.status === "loading") {
      return (
        <p className="max-w-sm text-center text-sm leading-6 text-muted-foreground">
          Loading goal.md...
        </p>
      );
    }

    if (goalFileState.status === "missing" || goalFileState.status === "creating") {
      return (
        <Empty className="max-w-md">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FilePlus2
                aria-hidden="true"
                strokeWidth={2}
              />
            </EmptyMedia>
            <EmptyTitle>No goal.md found</EmptyTitle>
            <EmptyDescription>
              Create the default goal.md in the selected repository to start
              controlling Codex runs from that repo.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              disabled={goalFileState.status === "creating"}
              onClick={() => {
                void handleCreateDefaultGoal();
              }}
              type="button"
            >
              <FilePlus2
                aria-hidden="true"
                data-icon="inline-start"
                strokeWidth={2}
              />
              {goalFileState.status === "creating" ? "Creating..." : "Create goal.md"}
            </Button>
          </EmptyContent>
        </Empty>
      );
    }

    if (goalFileState.status === "error") {
      return (
        <Empty className="max-w-md">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <AlertCircle
                aria-hidden="true"
                strokeWidth={2}
              />
            </EmptyMedia>
            <EmptyTitle>goal.md unavailable</EmptyTitle>
            <EmptyDescription>{goalFileState.error}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      );
    }

    if (goalFileState.status === "available") {
      return (
        <div
          className="goal-markdown min-h-full w-full break-words"
          dangerouslySetInnerHTML={{
            __html: renderedGoalHtml ?? "",
          }}
          title={goalFileState.goalPath ?? undefined}
        />
      );
    }

    return null;
  }

  return (
    <Card
      aria-labelledby="goal-document-title"
      role="region"
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg"
    >
      <CardHeader className="flex min-h-14 flex-row flex-wrap items-center justify-between gap-2 border-b px-4 py-3 sm:flex-nowrap sm:py-0">
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
        <CardDescription className="hidden min-w-0 max-w-[55%] truncate text-right text-xs font-medium sm:block sm:max-w-none">
          Rendered document
        </CardDescription>
      </CardHeader>
      <CardContent
        className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 py-10 data-[goal-available=true]:items-start data-[goal-available=true]:justify-start data-[goal-available=true]:py-4"
        data-goal-available={goalFileState.status === "available"}
      >
        {renderGoalPanelContent()}
      </CardContent>
    </Card>
  );
}

function LogsSummaryPanel({
  runnerStatus,
  runtimeStream,
}: {
  runnerStatus: RunnerStatus;
  runtimeStream: RuntimeStreamState;
}) {
  const connectionConfig =
    connectionStatusConfig[runtimeStream.connectionStatus];
  const latestSummary = runtimeStream.latestSummary;
  const progressLabel = formatProgress(runtimeStream.progress);

  return (
    <Card
      aria-labelledby="logs-summary-title"
      role="region"
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg"
    >
      <CardHeader className="flex min-h-14 flex-row flex-wrap items-center justify-between gap-2 border-b px-4 py-3 sm:flex-nowrap sm:py-0">
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
        <div className="flex min-w-0 items-center gap-2">
          <CardDescription className="hidden min-w-0 max-w-[55%] truncate text-right text-xs font-medium sm:block sm:max-w-none">
            {progressLabel}
          </CardDescription>
          <Badge
            className="h-6 w-fit shrink-0"
            variant={connectionConfig.variant}
          >
            {connectionConfig.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid min-h-0 flex-1 gap-0 overflow-hidden p-0 md:grid-cols-[minmax(0,1fr)_18rem]">
        <section
          aria-labelledby="live-logs-title"
          className="flex min-h-0 min-w-0 flex-col border-b md:border-b-0 md:border-r"
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
          <div
            aria-live="polite"
            className="min-h-0 flex-1 overflow-auto bg-zinc-950 px-4 py-3"
          >
            {runtimeStream.logs.length > 0 ? (
              <ol className="grid gap-2">
                {runtimeStream.logs.map((entry) => (
                  <li
                    className="grid min-w-0 gap-1 font-mono text-xs leading-5 text-zinc-100 sm:grid-cols-[4.5rem_minmax(0,1fr)]"
                    key={entry.id}
                  >
                    <span
                      className={
                        entry.stream === "stderr"
                          ? "font-semibold text-red-300"
                          : entry.stream === "stdout"
                            ? "font-semibold text-emerald-300"
                            : "font-semibold text-sky-300"
                      }
                    >
                      {formatLogStream(entry.stream)}
                    </span>
                    <span className="min-w-0 whitespace-pre-wrap break-words text-zinc-200">
                      {entry.message}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="flex min-h-full items-center justify-center py-5">
                <p className="max-w-sm text-center font-mono text-xs leading-5 text-zinc-400">
                  Run output will stream here when a Codex loop starts.
                </p>
              </div>
            )}
          </div>
        </section>

        <section
          aria-labelledby="latest-summary-title"
          className="flex min-h-0 min-w-0 flex-col"
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
          <dl className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto px-4 py-4 text-xs">
            <div className="grid gap-1">
              <dt className="font-medium text-zinc-500">Status</dt>
              <dd>
                <RunnerStatusBadge status={runnerStatus} />
              </dd>
            </div>
            <div className="grid gap-1">
              <dt className="font-medium text-zinc-500">Progress</dt>
              <dd className="text-sm font-medium text-zinc-800">
                {progressLabel}
              </dd>
            </div>
            <div className="grid gap-1">
              <dt className="font-medium text-zinc-500">Last event</dt>
              <dd className="leading-5 text-muted-foreground">
                {latestSummary?.message ??
                  "Run summaries will appear here after backend events are received."}
              </dd>
            </div>
            {latestSummary ? (
              <div className="grid gap-1">
                <dt className="font-medium text-zinc-500">Event status</dt>
                <dd className="text-sm font-medium text-zinc-800">
                  {statusBadgeConfig[latestSummary.status].label}
                </dd>
              </div>
            ) : null}
          </dl>
        </section>
      </CardContent>
    </Card>
  );
}

function OperationsWorkspace({
  goalRefreshToken,
  onRepositorySelected,
  onRunnerStatusChange,
  repositorySelection,
  runnerStatus,
  runtimeStream,
}: {
  goalRefreshToken: number;
  onRepositorySelected: (repositoryPath: string) => void;
  onRunnerStatusChange: (status: RunnerStatus) => void;
  repositorySelection: RepositorySelectionState;
  runnerStatus: RunnerStatus;
  runtimeStream: RuntimeStreamState;
}) {
  return (
    <div className="grid h-full min-h-0 w-full grid-rows-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.85fr)] gap-3 overflow-hidden sm:gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,20rem)] lg:grid-rows-[minmax(0,1fr)_minmax(0,0.42fr)]">
      <div className="min-h-0 min-w-0 overflow-hidden lg:col-start-1 lg:row-start-1">
        <GoalDocumentPanel
          goalRefreshToken={goalRefreshToken}
          repositorySelection={repositorySelection}
        />
      </div>
      <aside className="min-h-0 min-w-0 overflow-hidden lg:col-start-2 lg:row-start-1">
        <ControlsPanel
          onRepositorySelected={onRepositorySelected}
          onRunnerStatusChange={onRunnerStatusChange}
          repositorySelection={repositorySelection}
          runnerStatus={runnerStatus}
        />
      </aside>
      <div className="min-h-0 min-w-0 overflow-hidden lg:col-span-2 lg:row-start-2">
        <LogsSummaryPanel
          runnerStatus={runnerStatus}
          runtimeStream={runtimeStream}
        />
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
  const [runnerStatus, setRunnerStatus] = useState<RunnerStatus>("idle");
  const [goalRefreshToken, setGoalRefreshToken] = useState(0);
  const [runtimeStream, setRuntimeStream] = useState<RuntimeStreamState>(
    INITIAL_RUNTIME_STREAM_STATE,
  );
  const selectedRepositoryPathRef = useRef<string | null>(null);

  useEffect(() => {
    selectedRepositoryPathRef.current =
      repositorySelection.status === "ready"
        ? repositorySelection.repositoryPath
        : null;
  }, [repositorySelection]);

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

  useEffect(() => {
    const eventSource = new EventSource("/api/events");

    setRuntimeStream((currentStream) => ({
      ...currentStream,
      connectionStatus: "connecting",
    }));

    function requestGoalRefresh(): void {
      setGoalRefreshToken((currentToken) => currentToken + 1);
    }

    function handleStatus(event: MessageEvent<string>): void {
      const statusEvent = parseSseData<StatusEvent>(event);

      if (!statusEvent || !isRunnerStatus(statusEvent.status)) {
        return;
      }

      setRunnerStatus(statusEvent.status);
      setRuntimeStream((currentStream) => ({
        ...currentStream,
        connectionStatus: "open",
      }));
      setRepositorySelection({
        status: "ready",
        repositoryPath: statusEvent.selectedRepositoryPath,
      });
    }

    function handleLogs(event: MessageEvent<string>): void {
      const logsEvent = parseSseData<LogsEvent>(event);

      if (!logsEvent || !Array.isArray(logsEvent.entries)) {
        return;
      }

      setRuntimeStream((currentStream) => ({
        ...currentStream,
        logs: logsEvent.entries,
      }));
    }

    function handleProgress(event: MessageEvent<string>): void {
      const progress = parseSseData<RunProgressEvent>(event);

      if (
        !progress ||
        typeof progress.currentRun !== "number" ||
        (progress.totalRuns !== null && typeof progress.totalRuns !== "number")
      ) {
        return;
      }

      setRuntimeStream((currentStream) => ({
        ...currentStream,
        progress,
      }));
    }

    function handleSummary(event: MessageEvent<string>): void {
      const summary = parseSseData<RunSummaryEvent>(event);

      setRuntimeStream((currentStream) => ({
        ...currentStream,
        latestSummary: summary,
      }));

      if (summary?.status === "complete" || summary?.status === "blocked") {
        requestGoalRefresh();
      }
    }

    function handleGoalChanged(event: MessageEvent<string>): void {
      const goalChanged = parseSseData<GoalChangedEvent>(event);

      if (
        goalChanged?.repositoryPath &&
        goalChanged.repositoryPath === selectedRepositoryPathRef.current
      ) {
        requestGoalRefresh();
      }
    }

    function handleError(): void {
      setRuntimeStream((currentStream) => ({
        ...currentStream,
        connectionStatus: "error",
      }));
    }

    eventSource.addEventListener("status", handleStatus);
    eventSource.addEventListener("logs", handleLogs);
    eventSource.addEventListener("progress", handleProgress);
    eventSource.addEventListener("summary", handleSummary);
    eventSource.addEventListener("goalChanged", handleGoalChanged);
    eventSource.addEventListener("error", handleError);

    return () => {
      eventSource.removeEventListener("status", handleStatus);
      eventSource.removeEventListener("logs", handleLogs);
      eventSource.removeEventListener("progress", handleProgress);
      eventSource.removeEventListener("summary", handleSummary);
      eventSource.removeEventListener("goalChanged", handleGoalChanged);
      eventSource.removeEventListener("error", handleError);
      eventSource.close();
    };
  }, []);

  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-zinc-50 text-zinc-950">
      <TopBar repositorySelection={repositorySelection} status={runnerStatus} />
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 px-4 py-4 sm:px-6 sm:py-6">
        <OperationsWorkspace
          goalRefreshToken={goalRefreshToken}
          onRepositorySelected={(repositoryPath) => {
            setRepositorySelection({
              status: "ready",
              repositoryPath,
            });
          }}
          onRunnerStatusChange={setRunnerStatus}
          repositorySelection={repositorySelection}
          runnerStatus={runnerStatus}
          runtimeStream={runtimeStream}
        />
      </div>
    </main>
  );
}
