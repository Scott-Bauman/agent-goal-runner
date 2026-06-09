import {
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import {
  BadgeCheck,
  Bot,
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
  AGENT_PROVIDERS,
  DEFAULT_AGENT_PROVIDER,
  type AgentProvider,
} from "@/web/runner/agentProviders";
import {
  CLAUDE_MODELS,
  type ClaudeModel,
} from "@/web/runner/claudeOptions";
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
type ClaudeModelSelection = ClaudeModel | typeof CLI_DEFAULT_OPTION;
type StateSetter<T> = Dispatch<SetStateAction<T>>;

const PROVIDER_OPTIONS: AgentProvider[] = [...AGENT_PROVIDERS];
const MODEL_OPTIONS: ModelSelection[] = [CLI_DEFAULT_OPTION, ...CODEX_MODELS];
const REASONING_EFFORT_OPTIONS: ReasoningEffortSelection[] = [
  CLI_DEFAULT_OPTION,
  ...CODEX_REASONING_EFFORTS,
];
const CLAUDE_MODEL_OPTIONS: ClaudeModelSelection[] = [
  CLI_DEFAULT_OPTION,
  ...CLAUDE_MODELS,
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
    icon: Bot,
    id: "run-setup-provider",
    info: "Choose which local agent CLI runs this prompt.",
    title: "Provider",
  },
  {
    icon: BrainCircuit,
    id: "run-setup-model",
    info: "Choose provider-specific model settings, or leave them on the CLI defaults.",
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
  PROVIDER_SECTION,
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

function toRunClaudeModel(selection: ClaudeModelSelection): ClaudeModel | null {
  return selection === CLI_DEFAULT_OPTION ? null : selection;
}

function getSelectedRepositoryPath(
  repositorySelection: RepositorySelectionState,
): string | null {
  return repositorySelection.status === "ready"
    ? repositorySelection.repositoryPath
    : null;
}

function isCountInAllowedRange(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 100;
}

function canSubmitRun({
  hasRepositoryPath,
  isPromptValid,
  isReviewIntervalValid,
  isReviewPromptValid,
  isRunActive,
  isRunControlPending,
  isRunCountValid,
  isRepositorySubmitting,
}: {
  hasRepositoryPath: boolean;
  isPromptValid: boolean;
  isRepositorySubmitting: boolean;
  isReviewIntervalValid: boolean;
  isReviewPromptValid: boolean;
  isRunActive: boolean;
  isRunControlPending: boolean;
  isRunCountValid: boolean;
}): boolean {
  return (
    hasRepositoryPath &&
    isPromptValid &&
    isRunCountValid &&
    isReviewIntervalValid &&
    isReviewPromptValid &&
    !isRunActive &&
    !isRunControlPending &&
    !isRepositorySubmitting
  );
}

function canSubmitStop({
  isRepositorySubmitting,
  isRunControlPending,
  runnerStatus,
}: {
  isRepositorySubmitting: boolean;
  isRunControlPending: boolean;
  runnerStatus: RunnerStatus;
}): boolean {
  return (
    runnerStatus === "running" &&
    !isRunControlPending &&
    !isRepositorySubmitting
  );
}

function formatValidationIssueMessages(issues: ValidationIssue[]): string[] {
  return issues.map((issue) =>
    issue.path === "request" || issue.path === "path"
      ? issue.message
      : `${issue.path}: ${issue.message}`,
  );
}

function FormAlert({
  error,
  errorId,
  issueMessages,
  issuesId,
}: {
  error: string | null;
  errorId: string;
  issueMessages: string[];
  issuesId: string;
}) {
  if (!error && issueMessages.length === 0) {
    return null;
  }

  return (
    <div
      className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive"
      role="alert"
    >
      {error ? (
        <p
          className="font-medium"
          id={errorId}
        >
          {error}
        </p>
      ) : null}
      {issueMessages.length > 0 ? (
        <ul
          className="flex flex-col gap-1"
          id={issuesId}
        >
          {issueMessages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SelectionCombobox<T extends string>({
  id,
  items,
  label,
  onValueChange,
  value,
}: {
  id: string;
  items: readonly T[];
  label: string;
  onValueChange: (value: T) => void;
  value: T;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label
        className="text-xs font-medium text-foreground"
        htmlFor={id}
      >
        {label}
      </label>
      <Combobox<T>
        items={items}
        onValueChange={(nextValue) => {
          if (nextValue) {
            onValueChange(nextValue);
          }
        }}
        value={value}
      >
        <ComboboxInput
          id={id}
          readOnly
        />
        <ComboboxContent>
          <ComboboxList>
            {items.map((option) => (
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
  );
}

function RunControlButtons({
  canStartRun,
  canStopRun,
  onRunStart,
  onRunStop,
  status,
}: {
  canStartRun: boolean;
  canStopRun: boolean;
  onRunStart: () => void;
  onRunStop: () => void;
  status: RunControlFormState["status"];
}) {
  return (
    <>
      <Button
        disabled={!canStartRun}
        onClick={onRunStart}
        type="button"
      >
        <Play
          aria-hidden="true"
          data-icon="inline-start"
          strokeWidth={2}
        />
        {status === "starting" ? "Starting..." : "Start"}
      </Button>
      <Button
        disabled={!canStopRun}
        onClick={onRunStop}
        type="button"
        variant="outline"
      >
        <Square
          aria-hidden="true"
          data-icon="inline-start"
          strokeWidth={2}
        />
        {status === "stopping" ? "Stopping..." : "Stop"}
      </Button>
    </>
  );
}

function RepositorySetupSection({
  describedBy,
  form,
  hasError,
  issueMessages,
  onBrowse,
}: {
  describedBy: string | undefined;
  form: RepositoryPathFormState;
  hasError: boolean;
  issueMessages: string[];
  onBrowse: () => void;
}) {
  return (
    <SetupArea
      icon={REPOSITORY_SECTION.icon}
      id={REPOSITORY_SECTION.id}
      title={REPOSITORY_SECTION.title}
    >
      <Button
        aria-describedby={describedBy}
        aria-invalid={hasError}
        disabled={form.status === "submitting"}
        onClick={onBrowse}
        type="button"
        variant="outline"
      >
        <FolderOpen
          aria-hidden="true"
          data-icon="inline-start"
          strokeWidth={2}
        />
        {form.status === "submitting" ? "Choosing..." : "Choose Folder"}
      </Button>
      <FormAlert
        error={form.error}
        errorId="repository-path-error"
        issueMessages={issueMessages}
        issuesId="repository-path-issues"
      />
    </SetupArea>
  );
}

function PromptSetupSection({
  onPromptChange,
  prompt,
}: {
  onPromptChange: (prompt: string) => void;
  prompt: string;
}) {
  return (
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
            onPromptChange(event.target.value);
          }}
          value={prompt}
        />
      </div>
    </SetupArea>
  );
}

function ProviderSetupSection({
  onProviderChange,
  provider,
}: {
  onProviderChange: (provider: AgentProvider) => void;
  provider: AgentProvider;
}) {
  return (
    <SetupArea
      icon={PROVIDER_SECTION.icon}
      id={PROVIDER_SECTION.id}
      info={PROVIDER_SECTION.info}
      title={PROVIDER_SECTION.title}
    >
      <SelectionCombobox
        id="agent-provider"
        items={PROVIDER_OPTIONS}
        label="Provider"
        onValueChange={onProviderChange}
        value={provider}
      />
    </SetupArea>
  );
}

function ModelSetupSection({
  claudeModel,
  model,
  onClaudeModelChange,
  onModelChange,
  onReasoningEffortChange,
  provider,
  reasoningEffort,
}: {
  claudeModel: ClaudeModelSelection;
  model: ModelSelection;
  onClaudeModelChange: (model: ClaudeModelSelection) => void;
  onModelChange: (model: ModelSelection) => void;
  onReasoningEffortChange: (reasoningEffort: ReasoningEffortSelection) => void;
  provider: AgentProvider;
  reasoningEffort: ReasoningEffortSelection;
}) {
  return (
    <SetupArea
      icon={MODEL_SECTION.icon}
      id={MODEL_SECTION.id}
      info={MODEL_SECTION.info}
      title={MODEL_SECTION.title}
    >
      <div className="grid gap-3">
        {provider === "claude" ? (
          <SelectionCombobox
            id="claude-model"
            items={CLAUDE_MODEL_OPTIONS}
            label="Claude model"
            onValueChange={onClaudeModelChange}
            value={claudeModel}
          />
        ) : (
          <>
            <SelectionCombobox
              id="codex-model"
              items={MODEL_OPTIONS}
              label="Codex model"
              onValueChange={onModelChange}
              value={model}
            />
            <SelectionCombobox
              id="reasoning-effort"
              items={REASONING_EFFORT_OPTIONS}
              label="Codex reasoning"
              onValueChange={onReasoningEffortChange}
              value={reasoningEffort}
            />
          </>
        )}
      </div>
    </SetupArea>
  );
}

function RunCountSetupSection({
  isValid,
  onRunCountChange,
  runCount,
}: {
  isValid: boolean;
  onRunCountChange: (runCount: string) => void;
  runCount: string;
}) {
  return (
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
            aria-invalid={!isValid}
            id="run-count"
            inputMode="numeric"
            max={100}
            min={1}
            onChange={(event) => {
              onRunCountChange(event.target.value);
            }}
            step={1}
            type="number"
            value={runCount}
          />
        </div>
      </div>
    </SetupArea>
  );
}

function VerificationSetupSection({
  commands,
  setCommands,
}: {
  commands: string[];
  setCommands: StateSetter<string[]>;
}) {
  return (
    <SetupArea
      icon={VERIFICATION_SECTION.icon}
      id={VERIFICATION_SECTION.id}
      info={VERIFICATION_SECTION.info}
      title={VERIFICATION_SECTION.title}
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-2">
          {commands.map((command, index) => (
            <VerificationCommandInput
              command={command}
              commandCount={commands.length}
              index={index}
              key={`verification-command-${index}`}
              setCommands={setCommands}
            />
          ))}
        </div>
        <Button
          aria-label="Add verification command"
          className="self-start"
          size="icon"
          type="button"
          variant="outline"
          onClick={() => {
            setCommands((currentCommands) => [...currentCommands, ""]);
          }}
        >
          <Plus
            aria-hidden="true"
            strokeWidth={2}
          />
        </Button>
      </div>
    </SetupArea>
  );
}

function VerificationCommandInput({
  command,
  commandCount,
  index,
  setCommands,
}: {
  command: string;
  commandCount: number;
  index: number;
  setCommands: StateSetter<string[]>;
}) {
  const commandId = `verification-command-${index}`;

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Input
        aria-label={`Verification command ${index + 1}`}
        className="min-w-0 font-mono text-xs"
        id={commandId}
        placeholder={index === 0 ? "npm test" : "npm run lint"}
        onChange={(event) => {
          setCommands((currentCommands) =>
            currentCommands.map((currentCommand, commandIndex) =>
              commandIndex === index ? event.target.value : currentCommand,
            ),
          );
        }}
        value={command}
      />
      {commandCount > 1 ? (
        <Button
          aria-label={`Remove verification command ${index + 1}`}
          size="icon"
          type="button"
          variant="ghost"
          onClick={() => {
            setCommands((currentCommands) =>
              currentCommands.filter(
                (_currentCommand, commandIndex) => commandIndex !== index,
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
}

function CommitSetupSection({
  autoCommit,
  onAutoCommitChange,
  reviewEnabled,
}: {
  autoCommit: boolean;
  onAutoCommitChange: StateSetter<boolean>;
  reviewEnabled: boolean;
}) {
  return (
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
                onAutoCommitChange((currentAutoCommit) => !currentAutoCommit);
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
  );
}

function ReviewSetupSection({
  reviewClaudeModel,
  isPromptValid,
  isReviewIntervalValid,
  onReviewEnabledChange,
  parsedReviewIntervalCommits,
  reviewProvider,
  reviewEnabled,
  reviewIntervalCommits,
  reviewModel,
  reviewPrompt,
  reviewReasoningEffort,
  setAutoCommit,
  setReviewClaudeModel,
  setReviewIntervalCommits,
  setReviewModel,
  setReviewPrompt,
  setReviewProvider,
  setReviewReasoningEffort,
}: {
  reviewClaudeModel: ClaudeModelSelection;
  isPromptValid: boolean;
  isReviewIntervalValid: boolean;
  onReviewEnabledChange: StateSetter<boolean>;
  parsedReviewIntervalCommits: number;
  reviewProvider: AgentProvider;
  reviewEnabled: boolean;
  reviewIntervalCommits: string;
  reviewModel: ModelSelection;
  reviewPrompt: string;
  reviewReasoningEffort: ReasoningEffortSelection;
  setAutoCommit: StateSetter<boolean>;
  setReviewClaudeModel: StateSetter<ClaudeModelSelection>;
  setReviewIntervalCommits: StateSetter<string>;
  setReviewModel: StateSetter<ModelSelection>;
  setReviewPrompt: StateSetter<string>;
  setReviewProvider: StateSetter<AgentProvider>;
  setReviewReasoningEffort: StateSetter<ReasoningEffortSelection>;
}) {
  return (
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
              onReviewEnabledChange((currentReviewEnabled) => {
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
          <ReviewSettings
            reviewClaudeModel={reviewClaudeModel}
            isPromptValid={isPromptValid}
            isReviewIntervalValid={isReviewIntervalValid}
            parsedReviewIntervalCommits={parsedReviewIntervalCommits}
            reviewProvider={reviewProvider}
            reviewIntervalCommits={reviewIntervalCommits}
            reviewModel={reviewModel}
            reviewPrompt={reviewPrompt}
            reviewReasoningEffort={reviewReasoningEffort}
            setReviewClaudeModel={setReviewClaudeModel}
            setReviewIntervalCommits={setReviewIntervalCommits}
            setReviewModel={setReviewModel}
            setReviewPrompt={setReviewPrompt}
            setReviewProvider={setReviewProvider}
            setReviewReasoningEffort={setReviewReasoningEffort}
          />
        ) : null}
      </div>
    </SetupArea>
  );
}

function ReviewSettings({
  reviewClaudeModel,
  isPromptValid,
  isReviewIntervalValid,
  parsedReviewIntervalCommits,
  reviewProvider,
  reviewIntervalCommits,
  reviewModel,
  reviewPrompt,
  reviewReasoningEffort,
  setReviewClaudeModel,
  setReviewIntervalCommits,
  setReviewModel,
  setReviewPrompt,
  setReviewProvider,
  setReviewReasoningEffort,
}: {
  reviewClaudeModel: ClaudeModelSelection;
  isPromptValid: boolean;
  isReviewIntervalValid: boolean;
  parsedReviewIntervalCommits: number;
  reviewProvider: AgentProvider;
  reviewIntervalCommits: string;
  reviewModel: ModelSelection;
  reviewPrompt: string;
  reviewReasoningEffort: ReasoningEffortSelection;
  setReviewClaudeModel: StateSetter<ClaudeModelSelection>;
  setReviewIntervalCommits: StateSetter<string>;
  setReviewModel: StateSetter<ModelSelection>;
  setReviewPrompt: StateSetter<string>;
  setReviewProvider: StateSetter<AgentProvider>;
  setReviewReasoningEffort: StateSetter<ReasoningEffortSelection>;
}) {
  return (
    <div className="review-settings-panel grid gap-3">
      <ReviewIntervalInput
        isValid={isReviewIntervalValid}
        reviewIntervalCommits={reviewIntervalCommits}
        setReviewIntervalCommits={setReviewIntervalCommits}
        setReviewPrompt={setReviewPrompt}
      />
      <SelectionCombobox
        id="review-provider"
        items={PROVIDER_OPTIONS}
        label="Review provider"
        onValueChange={setReviewProvider}
        value={reviewProvider}
      />
      <div className="grid gap-3">
        {reviewProvider === "claude" ? (
          <SelectionCombobox
            id="review-claude-model"
            items={CLAUDE_MODEL_OPTIONS}
            label="Review Claude model"
            onValueChange={setReviewClaudeModel}
            value={reviewClaudeModel}
          />
        ) : (
          <>
            <SelectionCombobox
              id="review-model"
              items={MODEL_OPTIONS}
              label="Review Codex model"
              onValueChange={setReviewModel}
              value={reviewModel}
            />
            <SelectionCombobox
              id="review-reasoning-effort"
              items={REASONING_EFFORT_OPTIONS}
              label="Review Codex reasoning"
              onValueChange={setReviewReasoningEffort}
              value={reviewReasoningEffort}
            />
          </>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <label
          className="text-xs font-medium text-foreground"
          htmlFor="review-prompt"
        >
          Review prompt
        </label>
        <Textarea
          aria-invalid={!isPromptValid}
          className="min-h-28 resize-y leading-5"
          id="review-prompt"
          placeholder={createDefaultReviewPrompt(parsedReviewIntervalCommits)}
          onChange={(event) => {
            setReviewPrompt(event.target.value);
          }}
          value={reviewPrompt}
        />
      </div>
    </div>
  );
}

function ReviewIntervalInput({
  isValid,
  reviewIntervalCommits,
  setReviewIntervalCommits,
  setReviewPrompt,
}: {
  isValid: boolean;
  reviewIntervalCommits: string;
  setReviewIntervalCommits: StateSetter<string>;
  setReviewPrompt: StateSetter<string>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label
        className="text-xs font-medium text-foreground"
        htmlFor="review-interval-commits"
      >
        Review every
      </label>
      <Input
        aria-invalid={!isValid}
        id="review-interval-commits"
        inputMode="numeric"
        max={100}
        min={1}
        onChange={(event) => {
          const nextIntervalCommits = event.target.value;
          const currentParsedIntervalCommits = Number(reviewIntervalCommits);
          const nextParsedIntervalCommits = Number(nextIntervalCommits);

          setReviewPrompt((currentReviewPrompt) => {
            const currentDefaultPrompt = createDefaultReviewPrompt(
              currentParsedIntervalCommits,
            );

            if (currentReviewPrompt !== currentDefaultPrompt) {
              return currentReviewPrompt;
            }

            return createDefaultReviewPrompt(nextParsedIntervalCommits);
          });
          setReviewIntervalCommits(nextIntervalCommits);
        }}
        step={1}
        type="number"
        value={reviewIntervalCommits}
      />
    </div>
  );
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
  const [provider, setProvider] = useState<AgentProvider>(
    DEFAULT_AGENT_PROVIDER,
  );
  const [runCount, setRunCount] = useState("1");
  const [verificationCommands, setVerificationCommands] = useState([""]);
  const [autoCommit, setAutoCommit] = useState(false);
  const [model, setModel] = useState<ModelSelection>("gpt-5.4");
  const [reasoningEffort, setReasoningEffort] =
    useState<ReasoningEffortSelection>("high");
  const [claudeModel, setClaudeModel] =
    useState<ClaudeModelSelection>(CLI_DEFAULT_OPTION);
  const [reviewEnabled, setReviewEnabled] = useState(false);
  const [reviewProvider, setReviewProvider] = useState<AgentProvider>(
    DEFAULT_AGENT_PROVIDER,
  );
  const [reviewIntervalCommits, setReviewIntervalCommits] = useState(
    String(DEFAULT_REVIEW_INTERVAL_COMMITS),
  );
  const [reviewPrompt, setReviewPrompt] = useState(DEFAULT_REVIEW_PROMPT);
  const [reviewModel, setReviewModel] = useState<ModelSelection>("gpt-5.4");
  const [reviewReasoningEffort, setReviewReasoningEffort] =
    useState<ReasoningEffortSelection>("high");
  const [reviewClaudeModel, setReviewClaudeModel] =
    useState<ClaudeModelSelection>(CLI_DEFAULT_OPTION);
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
  const selectedRepositoryPath = getSelectedRepositoryPath(repositorySelection);
  const repositoryPathErrorId = "repository-path-error";
  const repositoryPathIssuesId = "repository-path-issues";
  const runControlErrorId = "run-control-error";
  const runControlIssuesId = "run-control-issues";
  const hasRepositoryPathError =
    repositoryPathForm.error !== null || repositoryPathForm.issues.length > 0;
  const repositoryPathIssueMessages = formatValidationIssueMessages(
    repositoryPathForm.issues,
  );
  const runControlIssueMessages = formatValidationIssueMessages(
    runControlForm.issues,
  );
  const repositoryBrowseDescribedBy = hasRepositoryPathError
    ? `${repositoryPathErrorId} ${repositoryPathIssuesId}`
    : undefined;
  const parsedRunCount = Number(runCount);
  const isRunCountValid = isCountInAllowedRange(parsedRunCount);
  const parsedReviewIntervalCommits = Number(reviewIntervalCommits);
  const isReviewIntervalValid =
    !reviewEnabled || isCountInAllowedRange(parsedReviewIntervalCommits);
  const isPromptValid = repeatPrompt.trim().length > 0;
  const isReviewPromptValid = !reviewEnabled || reviewPrompt.trim().length > 0;
  const isRunActive = isActiveRunnerStatus(runnerStatus);
  const isRunControlPending = runControlForm.status !== "idle";
  const isRepositorySubmitting = repositoryPathForm.status === "submitting";
  const canStartRun = canSubmitRun({
    hasRepositoryPath: selectedRepositoryPath !== null,
    isPromptValid,
    isRepositorySubmitting,
    isReviewIntervalValid,
    isReviewPromptValid,
    isRunActive,
    isRunControlPending,
    isRunCountValid,
  });
  const canStopRun = canSubmitStop({
    isRepositorySubmitting,
    isRunControlPending,
    runnerStatus,
  });

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
          provider,
          model: provider === "codex" ? toRunModel(model) : null,
          prompt: preferSkillReferenceSyntax(repeatPrompt),
          reasoningEffort:
            provider === "codex" ? toRunReasoningEffort(reasoningEffort) : null,
          claudeModel:
            provider === "claude" ? toRunClaudeModel(claudeModel) : null,
          review: createReviewRunRequest({
            claudeModel:
              reviewProvider === "claude"
                ? toRunClaudeModel(reviewClaudeModel)
                : null,
            intervalCommits: parsedReviewIntervalCommits,
            provider: reviewProvider,
            model: reviewProvider === "codex" ? toRunModel(reviewModel) : null,
            prompt: reviewPrompt,
            reasoningEffort:
              reviewProvider === "codex"
                ? toRunReasoningEffort(reviewReasoningEffort)
                : null,
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
    <RunControlButtons
      canStartRun={canStartRun}
      canStopRun={canStopRun}
      onRunStart={() => {
        void handleRunStart();
      }}
      onRunStop={() => {
        void handleRunStop();
      }}
      status={runControlForm.status}
    />
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
        <RepositorySetupSection
          describedBy={repositoryBrowseDescribedBy}
          form={repositoryPathForm}
          hasError={hasRepositoryPathError}
          issueMessages={repositoryPathIssueMessages}
          onBrowse={() => {
            void handleRepositoryBrowse();
          }}
        />
        <PromptSetupSection
          onPromptChange={setRepeatPrompt}
          prompt={repeatPrompt}
        />
        <ProviderSetupSection
          onProviderChange={setProvider}
          provider={provider}
        />
        <ModelSetupSection
          claudeModel={claudeModel}
          model={model}
          onClaudeModelChange={setClaudeModel}
          onModelChange={setModel}
          onReasoningEffortChange={setReasoningEffort}
          provider={provider}
          reasoningEffort={reasoningEffort}
        />
        <RunCountSetupSection
          isValid={isRunCountValid}
          onRunCountChange={setRunCount}
          runCount={runCount}
        />
        <VerificationSetupSection
          commands={verificationCommands}
          setCommands={setVerificationCommands}
        />
        <CommitSetupSection
          autoCommit={autoCommit}
          onAutoCommitChange={setAutoCommit}
          reviewEnabled={reviewEnabled}
        />
        <ReviewSetupSection
          reviewClaudeModel={reviewClaudeModel}
          isPromptValid={isReviewPromptValid}
          isReviewIntervalValid={isReviewIntervalValid}
          onReviewEnabledChange={setReviewEnabled}
          parsedReviewIntervalCommits={parsedReviewIntervalCommits}
          reviewProvider={reviewProvider}
          reviewEnabled={reviewEnabled}
          reviewIntervalCommits={reviewIntervalCommits}
          reviewModel={reviewModel}
          reviewPrompt={reviewPrompt}
          reviewReasoningEffort={reviewReasoningEffort}
          setAutoCommit={setAutoCommit}
          setReviewClaudeModel={setReviewClaudeModel}
          setReviewIntervalCommits={setReviewIntervalCommits}
          setReviewModel={setReviewModel}
          setReviewPrompt={setReviewPrompt}
          setReviewProvider={setReviewProvider}
          setReviewReasoningEffort={setReviewReasoningEffort}
        />
        <FormAlert
          error={runControlForm.error}
          errorId={runControlErrorId}
          issueMessages={runControlIssueMessages}
          issuesId={runControlIssuesId}
        />
      </div>
    </section>
  );
}
