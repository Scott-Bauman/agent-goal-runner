import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  BadgeCheck,
  BrainCircuit,
  FolderGit2,
  FolderOpen,
  GitCommitHorizontal,
  Info,
  ListChecks,
  MessageSquareText,
  Play,
  Plus,
  Repeat2,
  Square,
  type LucideIcon,
  X,
} from "lucide-react";

import { formatApiError } from "@/web/api/errors";
import type {
  ApiErrorResponse,
  RepositoryBrowseResponse,
  RunStartResponse,
  RunStopResponse,
  ValidationIssue,
} from "@/web/api/responses";
import {
  createDefaultReviewPrompt,
  createReviewRunRequest,
  getAutoCommitForReview,
  isReviewSettingsVisible,
  preferSkillReferenceSyntax,
} from "@/web/components/app/controlsPanelReview";
import { Button } from "@/web/components/ui/button";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/web/components/ui/tooltip";
import {
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
const DEFAULT_REVIEW_INTERVAL_COMMITS = 3;
const DEFAULT_REVIEW_PROMPT = createDefaultReviewPrompt(
  DEFAULT_REVIEW_INTERVAL_COMMITS,
);
const CLI_DEFAULT_OPTION = "CLI default";

type ModelSelection = CodexModel | typeof CLI_DEFAULT_OPTION;
type ReasoningEffortSelection = CodexReasoningEffort | typeof CLI_DEFAULT_OPTION;

const MODEL_OPTIONS: ModelSelection[] = [CLI_DEFAULT_OPTION, ...CODEX_MODELS];
const REASONING_EFFORT_OPTIONS: ReasoningEffortSelection[] = [
  CLI_DEFAULT_OPTION,
  ...CODEX_REASONING_EFFORTS,
];

export const RUN_SETUP_SECTIONS = [
  {
    icon: FolderGit2,
    id: "run-setup-repository",
    title: "Repository",
  },
  {
    icon: MessageSquareText,
    id: "run-setup-prompt",
    info: "The prompt sent to Codex for each run. Use goal.md guidance when you want Codex to continue project work.",
    title: "Prompt",
  },
  {
    icon: BrainCircuit,
    id: "run-setup-model",
    info: "Choose the Codex model and reasoning effort, or leave both on the CLI defaults.",
    title: "Model",
  },
  {
    icon: Repeat2,
    id: "run-setup-runs",
    info: "Set how many Codex passes to run for this request.",
    title: "Run",
  },
  {
    icon: ListChecks,
    id: "run-setup-verification",
    info: "Runs after each successful Codex pass. All commands must pass before the next run or auto-commit.",
    title: "Verification",
  },
  {
    icon: GitCommitHorizontal,
    id: "run-setup-commit",
    info: "When enabled, commits changes after each successful run, after verification commands pass when present.",
    title: "Commit",
  },
  {
    icon: BadgeCheck,
    id: "run-setup-review",
    info: "Runs a separate review pass after a set number of successful auto-commits.",
    title: "Review",
  },
] as const satisfies ReadonlyArray<{
  icon: LucideIcon;
  id: string;
  info?: string;
  title: string;
}>;

const [
  REPOSITORY_SECTION,
  PROMPT_SECTION,
  MODEL_SECTION,
  RUN_SECTION,
  VERIFICATION_SECTION,
  COMMIT_SECTION,
  REVIEW_SECTION,
] = RUN_SETUP_SECTIONS;

function SetupArea({
  children,
  icon: Icon,
  id,
  info,
  title,
}: {
  children: ReactNode;
  icon?: LucideIcon;
  id: string;
  info?: ReactNode;
  title: string;
}) {
  return (
    <div
      className="flex scroll-mt-3 flex-col gap-3 border-b border-border/80 pb-5 last:border-b-0 last:pb-0"
      id={id}
    >
      <div className="flex items-center gap-1.5">
        {Icon ? (
          <Icon
            aria-hidden="true"
            className="h-4 w-4 shrink-0 text-muted-foreground"
            strokeWidth={2}
          />
        ) : null}
        <h3 className="text-sm font-semibold leading-6 text-foreground">
          {title}
        </h3>
        {info ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={`About ${title}`}
                  className="size-6"
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Info
                    aria-hidden="true"
                    strokeWidth={2}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-64 leading-5">
                {info}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function toRunModel(selection: ModelSelection): CodexModel | null {
  return selection === CLI_DEFAULT_OPTION ? null : selection;
}

function toRunReasoningEffort(
  selection: ReasoningEffortSelection,
): CodexReasoningEffort | null {
  return selection === CLI_DEFAULT_OPTION ? null : selection;
}

export function ControlsPanel({
  commandTargetId,
  onRepositorySelected,
  onRunnerStatusChange,
  repositorySelection,
  runnerStatus,
}: {
  commandTargetId?: string;
  onRepositorySelected: (repositoryPath: string) => void;
  onRunnerStatusChange: (status: RunnerStatus) => void;
  repositorySelection: RepositorySelectionState;
  runnerStatus: RunnerStatus;
}) {
  const [repeatPrompt, setRepeatPrompt] = useState(DEFAULT_REPEAT_PROMPT);
  const [runCount, setRunCount] = useState("1");
  const [verificationCommands, setVerificationCommands] = useState([""]);
  const [autoCommit, setAutoCommit] = useState(false);
  const [model, setModel] = useState<ModelSelection>("gpt-5.4");
  const [reasoningEffort, setReasoningEffort] =
    useState<ReasoningEffortSelection>("high");
  const [reviewEnabled, setReviewEnabled] = useState(false);
  const [reviewIntervalCommits, setReviewIntervalCommits] = useState(
    String(DEFAULT_REVIEW_INTERVAL_COMMITS),
  );
  const [reviewPrompt, setReviewPrompt] = useState(DEFAULT_REVIEW_PROMPT);
  const [reviewModel, setReviewModel] = useState<ModelSelection>("gpt-5.4");
  const [reviewReasoningEffort, setReviewReasoningEffort] =
    useState<ReasoningEffortSelection>("high");
  const [commandTarget, setCommandTarget] = useState<HTMLElement | null>(null);
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
  const parsedReviewIntervalCommits = Number(reviewIntervalCommits);
  const isReviewIntervalValid =
    !reviewEnabled ||
    (Number.isInteger(parsedReviewIntervalCommits) &&
      parsedReviewIntervalCommits >= 1 &&
      parsedReviewIntervalCommits <= 100);
  const isPromptValid = repeatPrompt.trim().length > 0;
  const isReviewPromptValid = !reviewEnabled || reviewPrompt.trim().length > 0;
  const isRunActive = isActiveRunnerStatus(runnerStatus);
  const isRunControlPending = runControlForm.status !== "idle";
  const canStartRun =
    selectedRepositoryPath !== null &&
    isPromptValid &&
    isRunCountValid &&
    isReviewIntervalValid &&
    isReviewPromptValid &&
    !isRunActive &&
    !isRunControlPending &&
    repositoryPathForm.status !== "submitting";
  const canStopRun =
    runnerStatus === "running" &&
    !isRunControlPending &&
    repositoryPathForm.status !== "submitting";

  useEffect(() => {
    if (!commandTargetId) {
      setCommandTarget(null);
      return;
    }

    setCommandTarget(document.getElementById(commandTargetId));
  }, [commandTargetId]);

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
          autoCommit: getAutoCommitForReview(reviewEnabled, autoCommit),
          model: toRunModel(model),
          prompt: preferSkillReferenceSyntax(repeatPrompt),
          reasoningEffort: toRunReasoningEffort(reasoningEffort),
          review: createReviewRunRequest({
            intervalCommits: parsedReviewIntervalCommits,
            model: toRunModel(reviewModel),
            prompt: reviewPrompt,
            reasoningEffort: toRunReasoningEffort(reviewReasoningEffort),
            reviewEnabled,
          }),
          runCount: parsedRunCount,
          verificationCommands: verificationCommands
            .map((command) => command.trim())
            .filter((command) => command.length > 0),
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

  const runControls = (
    <>
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
    </>
  );

  return (
    <section
      aria-labelledby="controls-panel-title"
      className="flex h-full min-h-0 min-w-0 flex-col"
      role="region"
    >
      {commandTarget
        ? createPortal(runControls, commandTarget)
        : commandTargetId
          ? null
          : (
              <div className="grid gap-3 px-2 pb-3 sm:grid-cols-2">
                {runControls}
              </div>
            )}
      <div className="sr-only">
        <h2 id="controls-panel-title">Run setup</h2>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-x-hidden overflow-y-auto px-1 py-2">
        <SetupArea
          icon={REPOSITORY_SECTION.icon}
          id={REPOSITORY_SECTION.id}
          title={REPOSITORY_SECTION.title}
        >
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
        </SetupArea>

        <SetupArea
          icon={PROMPT_SECTION.icon}
          id={PROMPT_SECTION.id}
          info={PROMPT_SECTION.info}
          title={PROMPT_SECTION.title}
        >
          <div className="flex flex-col gap-2">
            <label
              className="sr-only"
              htmlFor="repeat-prompt"
            >
              Prompt
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
        </SetupArea>

        <SetupArea
          icon={MODEL_SECTION.icon}
          id={MODEL_SECTION.id}
          info={MODEL_SECTION.info}
          title={MODEL_SECTION.title}
        >
          <div className="grid gap-3">
            <div className="flex flex-col gap-2">
              <label
                className="text-xs font-medium text-foreground"
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
                className="text-xs font-medium text-foreground"
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
        </SetupArea>

        <SetupArea
          icon={RUN_SECTION.icon}
          id={RUN_SECTION.id}
          info={RUN_SECTION.info}
          title={RUN_SECTION.title}
        >
          <div className="grid gap-3">
            <div className="flex flex-col gap-2">
              <label
                className="sr-only"
                htmlFor="run-count"
              >
                Run count
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
          </div>
        </SetupArea>

        <SetupArea
          icon={VERIFICATION_SECTION.icon}
          id={VERIFICATION_SECTION.id}
          info={VERIFICATION_SECTION.info}
          title={VERIFICATION_SECTION.title}
        >
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-2">
              {verificationCommands.map((command, index) => {
                const commandId = `verification-command-${index}`;

                return (
                  <div
                    className="flex min-w-0 items-center gap-2"
                    key={commandId}
                  >
                    <Input
                      aria-label={`Verification command ${index + 1}`}
                      className="min-w-0 font-mono text-xs"
                      id={commandId}
                      placeholder={index === 0 ? "npm test" : "npm run lint"}
                      onChange={(event) => {
                        const nextCommands = [...verificationCommands];
                        nextCommands[index] = event.target.value;
                        setVerificationCommands(nextCommands);
                      }}
                      value={command}
                    />
                    {verificationCommands.length > 1 ? (
                      <Button
                        aria-label={`Remove verification command ${index + 1}`}
                        size="icon"
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setVerificationCommands((currentCommands) =>
                            currentCommands.filter(
                              (_currentCommand, commandIndex) =>
                                commandIndex !== index,
                            ),
                          );
                        }}
                      >
                        <X
                          aria-hidden="true"
                          strokeWidth={2}
                        />
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <Button
              aria-label="Add verification command"
              className="self-start"
              size="icon"
              type="button"
              variant="outline"
              onClick={() => {
                setVerificationCommands((currentCommands) => [
                  ...currentCommands,
                  "",
                ]);
              }}
            >
              <Plus
                aria-hidden="true"
                strokeWidth={2}
              />
            </Button>
          </div>
        </SetupArea>

        <SetupArea
          icon={COMMIT_SECTION.icon}
          id={COMMIT_SECTION.id}
          info={COMMIT_SECTION.info}
          title={COMMIT_SECTION.title}
        >
          <div className="flex flex-col gap-2">
            <span
              className="sr-only"
              id="auto-commit-label"
            >
              Auto-commit
            </span>
            <div className="flex h-9 items-center justify-between gap-3 rounded-md border border-input bg-muted px-3">
              <span
                className="text-xs font-medium text-muted-foreground"
                id="auto-commit-state"
              >
                {reviewEnabled ? "Required by review" : autoCommit ? "Enabled" : "Off"}
              </span>
              <button
                aria-checked={autoCommit}
                aria-describedby="auto-commit-state"
                aria-labelledby="auto-commit-label"
                className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent bg-muted-foreground/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[state=checked]:bg-primary"
                data-state={autoCommit ? "checked" : "unchecked"}
                disabled={reviewEnabled}
                id="auto-commit"
                onClick={() => {
                  if (!reviewEnabled) {
                    setAutoCommit((currentAutoCommit) => !currentAutoCommit);
                  }
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
        </SetupArea>

        <SetupArea
          icon={REVIEW_SECTION.icon}
          id={REVIEW_SECTION.id}
          info={REVIEW_SECTION.info}
          title={REVIEW_SECTION.title}
        >
          <div className="flex flex-col gap-3">
            <span
              className="sr-only"
              id="review-label"
            >
              Review
            </span>
            <div className="flex h-9 items-center justify-between gap-3 rounded-md border border-input bg-muted px-3">
              <span
                className="text-xs font-medium text-muted-foreground"
                id="review-state"
              >
                {reviewEnabled ? "Enabled" : "Off"}
              </span>
              <button
                aria-checked={reviewEnabled}
                aria-describedby="review-state"
                aria-labelledby="review-label"
                className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent bg-muted-foreground/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[state=checked]:bg-primary"
                data-state={reviewEnabled ? "checked" : "unchecked"}
                id="review-enabled"
                onClick={() => {
                  setReviewEnabled((currentReviewEnabled) => {
                    const nextReviewEnabled = !currentReviewEnabled;

                    if (nextReviewEnabled) {
                      setAutoCommit(true);
                    }

                    return nextReviewEnabled;
                  });
                }}
                role="switch"
                type="button"
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-4"
                  data-state={reviewEnabled ? "checked" : "unchecked"}
                />
              </button>
            </div>

            {isReviewSettingsVisible(reviewEnabled) ? (
              <div className="review-settings-panel grid gap-3">
                <div className="flex flex-col gap-2">
                  <label
                    className="text-xs font-medium text-foreground"
                    htmlFor="review-interval-commits"
                  >
                    Review every
                  </label>
                  <Input
                    aria-invalid={!isReviewIntervalValid}
                    id="review-interval-commits"
                    inputMode="numeric"
                    max={100}
                    min={1}
                    onChange={(event) => {
                      const nextIntervalCommits = event.target.value;
                      const currentParsedIntervalCommits =
                        Number(reviewIntervalCommits);
                      const nextParsedIntervalCommits =
                        Number(nextIntervalCommits);

                      setReviewPrompt((currentReviewPrompt) => {
                        const currentDefaultPrompt = createDefaultReviewPrompt(
                          currentParsedIntervalCommits,
                        );

                        if (currentReviewPrompt !== currentDefaultPrompt) {
                          return currentReviewPrompt;
                        }

                        return createDefaultReviewPrompt(
                          nextParsedIntervalCommits,
                        );
                      });
                      setReviewIntervalCommits(nextIntervalCommits);
                    }}
                    step={1}
                    type="number"
                    value={reviewIntervalCommits}
                  />
                </div>
                <div className="grid gap-3">
                  <div className="flex flex-col gap-2">
                    <label
                      className="text-xs font-medium text-foreground"
                      htmlFor="review-model"
                    >
                      Review model
                    </label>
                    <Combobox<ModelSelection>
                      items={MODEL_OPTIONS}
                      onValueChange={(value) => {
                        if (value) {
                          setReviewModel(value);
                        }
                      }}
                      value={reviewModel}
                    >
                      <ComboboxInput
                        id="review-model"
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
                      className="text-xs font-medium text-foreground"
                      htmlFor="review-reasoning-effort"
                    >
                      Review reasoning
                    </label>
                    <Combobox<ReasoningEffortSelection>
                      items={REASONING_EFFORT_OPTIONS}
                      onValueChange={(value) => {
                        if (value) {
                          setReviewReasoningEffort(value);
                        }
                      }}
                      value={reviewReasoningEffort}
                    >
                      <ComboboxInput
                        id="review-reasoning-effort"
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
                <div className="flex flex-col gap-2">
                  <label
                    className="text-xs font-medium text-foreground"
                    htmlFor="review-prompt"
                  >
                    Review prompt
                  </label>
                  <Textarea
                    aria-invalid={!isReviewPromptValid}
                    className="min-h-28 resize-y leading-5"
                    id="review-prompt"
                    placeholder={createDefaultReviewPrompt(
                      parsedReviewIntervalCommits,
                    )}
                    onChange={(event) => {
                      setReviewPrompt(event.target.value);
                    }}
                    value={reviewPrompt}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </SetupArea>

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
      </div>
    </section>
  );
}
