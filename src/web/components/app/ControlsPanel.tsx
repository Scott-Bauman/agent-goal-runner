import { useEffect, useState } from "react";
import { Check, FolderOpen, Play, Settings2, Square } from "lucide-react";

import { formatApiError } from "@/web/api/errors";
import type {
  ApiErrorResponse,
  RepositoryBrowseResponse,
  RunStartResponse,
  RunStopResponse,
  ValidationIssue,
} from "@/web/api/responses";
import { Button } from "@/web/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/web/components/ui/card";
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/web/components/ui/combobox";
import { Input } from "@/web/components/ui/input";
import { Textarea } from "@/web/components/ui/textarea";
import {
  getRepositoryLabel,
  getRepositoryBrowseResult,
  type RepositoryPathFormState,
  type RepositorySelectionState,
} from "@/web/repository/repositorySelection";
import {
  isActiveRunnerStatus,
  type RunnerStatus,
} from "@/web/runner/statuses";
import {
  CODEX_MODELS,
  CODEX_REASONING_EFFORTS,
  type CodexModel,
  type CodexReasoningEffort,
} from "@/web/runner/codexOptions";

type RunControlFormState = {
  status: "idle" | "starting" | "stopping";
  error: string | null;
  issues: ValidationIssue[];
};

const DEFAULT_REPEAT_PROMPT = [
  "Use goal.md as the source of truth.",
  "",
  "Complete the next valid unchecked item.",
].join("\n");
const CLI_DEFAULT_OPTION = "CLI default";

type ModelSelection = CodexModel | typeof CLI_DEFAULT_OPTION;
type ReasoningEffortSelection = CodexReasoningEffort | typeof CLI_DEFAULT_OPTION;

const MODEL_OPTIONS: ModelSelection[] = [CLI_DEFAULT_OPTION, ...CODEX_MODELS];
const REASONING_EFFORT_OPTIONS: ReasoningEffortSelection[] = [
  CLI_DEFAULT_OPTION,
  ...CODEX_REASONING_EFFORTS,
];

function toRunModel(selection: ModelSelection): CodexModel | null {
  return selection === CLI_DEFAULT_OPTION ? null : selection;
}

function toRunReasoningEffort(
  selection: ReasoningEffortSelection,
): CodexReasoningEffort | null {
  return selection === CLI_DEFAULT_OPTION ? null : selection;
}

export function ControlsPanel({
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
  const [repeatPrompt, setRepeatPrompt] = useState(DEFAULT_REPEAT_PROMPT);
  const [runCount, setRunCount] = useState("1");
  const [verificationCommand, setVerificationCommand] = useState("");
  const [autoCommit, setAutoCommit] = useState(false);
  const [model, setModel] = useState<ModelSelection>(CLI_DEFAULT_OPTION);
  const [reasoningEffort, setReasoningEffort] =
    useState<ReasoningEffortSelection>(CLI_DEFAULT_OPTION);
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
  const repositoryBrowseDescribedBy = hasRepositoryPathError
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

    setRunControlForm({
      status: "idle",
      error: null,
      issues: [],
    });
  }, [repositorySelection]);

  async function handleRepositoryBrowse() {
    setRepositoryPathForm({
      status: "submitting",
      error: null,
      issues: [],
    });

    try {
      const response = await fetch("/api/repository/browse", {
        method: "POST",
      });
      const responseBody = (await response.json()) as
        | RepositoryBrowseResponse
        | ApiErrorResponse;

      const browseResult = getRepositoryBrowseResult(response.ok, responseBody);

      if (browseResult.status === "cancelled") {
        setRepositoryPathForm({
          status: "idle",
          error: null,
          issues: [],
        });
        return;
      }

      if (browseResult.status === "error") {
        setRepositoryPathForm({
          status: "idle",
          error: browseResult.error,
          issues: browseResult.issues,
        });
        return;
      }

      onRepositorySelected(browseResult.repositoryPath);
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
          model: toRunModel(model),
          prompt: repeatPrompt,
          reasoningEffort: toRunReasoningEffort(reasoningEffort),
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
        <div className="flex flex-col gap-3">
          <span
            className="text-xs font-medium text-zinc-700"
          >
            Repository
          </span>
          <Button
            aria-describedby={repositoryBrowseDescribedBy}
            aria-invalid={hasRepositoryPathError}
            disabled={repositoryPathForm.status === "submitting"}
            onClick={() => {
              void handleRepositoryBrowse();
            }}
            type="button"
            variant="outline"
          >
            <FolderOpen
              aria-hidden="true"
              data-icon="inline-start"
              strokeWidth={2}
            />
            {repositoryPathForm.status === "submitting"
              ? "Choosing..."
              : "Choose Folder"}
          </Button>
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
        </div>

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
              htmlFor="codex-model"
            >
              Model
            </label>
            <Combobox<ModelSelection>
              items={MODEL_OPTIONS}
              onValueChange={(value) => {
                if (value) {
                  setModel(value);
                }
              }}
              value={model}
            >
              <ComboboxInput
                id="codex-model"
                readOnly
              />
              <ComboboxContent>
                <ComboboxList>
                  {MODEL_OPTIONS.map((option) => (
                    <ComboboxItem
                      key={option}
                      value={option}
                    >
                      {option}
                    </ComboboxItem>
                  ))}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </div>
          <div className="flex flex-col gap-2">
            <label
              className="text-xs font-medium text-zinc-700"
              htmlFor="reasoning-effort"
            >
              Reasoning effort
            </label>
            <Combobox<ReasoningEffortSelection>
              items={REASONING_EFFORT_OPTIONS}
              onValueChange={(value) => {
                if (value) {
                  setReasoningEffort(value);
                }
              }}
              value={reasoningEffort}
            >
              <ComboboxInput
                id="reasoning-effort"
                readOnly
              />
              <ComboboxContent>
                <ComboboxList>
                  {REASONING_EFFORT_OPTIONS.map((option) => (
                    <ComboboxItem
                      key={option}
                      value={option}
                    >
                      {option}
                    </ComboboxItem>
                  ))}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </div>
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
