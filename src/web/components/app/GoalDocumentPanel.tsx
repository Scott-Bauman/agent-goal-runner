import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  AlertCircle,
  Bot,
  Edit3,
  FilePlus2,
  FileText,
  ListChecks,
  Save,
  X,
} from "lucide-react";

import { getApiErrorMessage } from "@/web/api/errors";
import type { ApiErrorResponse, RunStartResponse } from "@/web/api/responses";
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
import { Textarea } from "@/web/components/ui/textarea";
import {
  buildAgentGoalPrompt,
  DEFAULT_MANUAL_GOAL_MARKDOWN,
  getGoalDocumentActionLabels,
  getGoalDocumentAvailability,
} from "@/web/goal/goalEditing";
import {
  getGoalFileLoadStartState,
  type GoalFileResponse,
  type GoalFileState,
} from "@/web/goal/goalFile";
import {
  extractGoalImplementationSteps,
  renderGoalMarkdown,
  type GoalImplementationStep,
} from "@/web/markdown";
import type { RepositorySelectionState } from "@/web/repository/repositorySelection";
import {
  toRunClaudeModel,
  toRunModel,
  toRunPiModel,
  toRunReasoningEffort,
  type AgentRunSelection,
} from "@/web/runner/runSelection";
import type { RunnerStatus } from "@/web/runner/statuses";

type GoalDraftState =
  | {
      mode: "none";
    }
  | {
      error: string | null;
      expectedRevision: string | null;
      markdown: string;
      mode: "manual-add" | "manual-edit";
      status: "editing" | "saving";
    }
  | {
      error: string | null;
      mode: "agent-add" | "agent-edit";
      prompt: string;
      status: "editing" | "starting";
    };

type GoalViewMode = "document" | "steps";

function toAvailableGoalState(goalFile: GoalFileResponse): GoalFileState {
  return {
    status: "available",
    error: null,
    goalPath: goalFile.goalPath,
    markdown: goalFile.markdown,
    repositoryPath: goalFile.repositoryPath,
    revision: goalFile.revision,
  };
}

export function GoalDocumentPanel({
  agentRunSelection,
  goalRefreshToken,
  onRunnerStatusChange,
  repositorySelection,
  runnerStatus,
}: {
  agentRunSelection: AgentRunSelection;
  goalRefreshToken: number;
  onRunnerStatusChange: (status: RunnerStatus) => void;
  repositorySelection: RepositorySelectionState;
  runnerStatus: RunnerStatus;
}) {
  const [goalFileState, setGoalFileState] = useState<GoalFileState>({
    status: "idle",
    error: null,
    goalPath: null,
    markdown: null,
    repositoryPath: null,
    revision: null,
  });
  const [draftState, setDraftState] = useState<GoalDraftState>({
    mode: "none",
  });
  const [goalViewMode, setGoalViewMode] = useState<GoalViewMode>("document");
  const selectedRepositoryPath =
    repositorySelection.status === "ready"
      ? repositorySelection.repositoryPath
      : null;
  const isDraftActive = draftState.mode !== "none";
  const isDraftPending =
    draftState.mode !== "none" &&
    (draftState.status === "saving" || draftState.status === "starting");
  const goalActionStatus =
    goalFileState.status === "available" || goalFileState.status === "missing"
      ? goalFileState.status
      : null;
  const goalActionLabels = goalActionStatus
    ? getGoalDocumentActionLabels(goalActionStatus)
    : null;
  const goalAvailability = getGoalDocumentAvailability({
    isSaving: isDraftPending,
    runnerStatus,
  });
  const renderedGoalHtml = useMemo(
    () =>
      goalFileState.status === "available" && goalFileState.markdown !== null
        ? renderGoalMarkdown(goalFileState.markdown)
        : null,
    [goalFileState.markdown, goalFileState.status],
  );
  const implementationSteps = useMemo(
    () =>
      goalFileState.status === "available" && goalFileState.markdown !== null
        ? extractGoalImplementationSteps(goalFileState.markdown)
        : [],
    [goalFileState.markdown, goalFileState.status],
  );

  const loadGoalFile = useCallback(async (signal?: AbortSignal) => {
    if (!selectedRepositoryPath) {
      return;
    }

    setGoalFileState((currentState) =>
      getGoalFileLoadStartState({
        currentState,
        selectedRepositoryPath,
      }),
    );

    try {
      const response = await fetch("/api/goal", {
        signal,
      });
      const responseBody = (await response.json()) as
        | GoalFileResponse
        | ApiErrorResponse;

      if (response.ok) {
        setGoalFileState(toAvailableGoalState(responseBody as GoalFileResponse));
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
          revision: null,
        });
        return;
      }

      setGoalFileState({
        status: "error",
        error: getApiErrorMessage(errorResponse, "Failed to load goal.md."),
        goalPath: null,
        markdown: null,
        repositoryPath: null,
        revision: null,
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
        revision: null,
      });
    }
  }, [selectedRepositoryPath]);

  useEffect(() => {
    if (!selectedRepositoryPath) {
      setGoalFileState({
        status: "idle",
        error: null,
        goalPath: null,
        markdown: null,
        repositoryPath: null,
        revision: null,
      });
      setDraftState({
        mode: "none",
      });
      setGoalViewMode("document");
      return;
    }

    const abortController = new AbortController();

    void loadGoalFile(abortController.signal);

    return () => {
      abortController.abort();
    };
  }, [goalRefreshToken, loadGoalFile, selectedRepositoryPath]);

  useEffect(() => {
    if (isDraftActive || goalFileState.status !== "available") {
      setGoalViewMode("document");
    }
  }, [goalFileState.status, isDraftActive]);

  function handleManualStart() {
    if (!goalAvailability.canRunGoalAction) {
      return;
    }

    if (goalFileState.status === "missing") {
      setDraftState({
        mode: "manual-add",
        error: null,
        expectedRevision: null,
        markdown: DEFAULT_MANUAL_GOAL_MARKDOWN,
        status: "editing",
      });
    }

    if (
      goalFileState.status === "available" &&
      goalFileState.markdown !== null &&
      goalFileState.revision !== null
    ) {
      setDraftState({
        mode: "manual-edit",
        error: null,
        expectedRevision: goalFileState.revision,
        markdown: goalFileState.markdown,
        status: "editing",
      });
    }
  }

  function handleAgentStart() {
    if (!goalAvailability.canRunGoalAction) {
      return;
    }

    if (goalFileState.status === "missing") {
      setDraftState({
        mode: "agent-add",
        error: null,
        prompt: "Create a goal.md for this repository.",
        status: "editing",
      });
    }

    if (goalFileState.status === "available") {
      setDraftState({
        mode: "agent-edit",
        error: null,
        prompt: "Update goal.md for the next implementation pass.",
        status: "editing",
      });
    }
  }

  function handleDraftCancel() {
    if (draftState.mode !== "none" && draftState.status !== "saving") {
      setDraftState({
        mode: "none",
      });
    }
  }

  async function handleManualSave() {
    if (
      (draftState.mode !== "manual-add" && draftState.mode !== "manual-edit") ||
      goalAvailability.isSaveDisabled
    ) {
      return;
    }

    setDraftState({
      ...draftState,
      error: null,
      status: "saving",
    });

    try {
      const response = await fetch("/api/goal", {
        body: JSON.stringify(
          draftState.mode === "manual-add"
            ? {
                markdown: draftState.markdown,
              }
            : {
                expectedRevision: draftState.expectedRevision,
                markdown: draftState.markdown,
              },
        ),
        headers: {
          "Content-Type": "application/json",
        },
        method: draftState.mode === "manual-add" ? "POST" : "PUT",
      });
      const responseBody = (await response.json()) as
        | GoalFileResponse
        | ApiErrorResponse;

      if (response.ok) {
        setGoalFileState(toAvailableGoalState(responseBody as GoalFileResponse));
        setDraftState({
          mode: "none",
        });
        return;
      }

      const errorResponse = responseBody as ApiErrorResponse;

      if (response.status === 409 && errorResponse.code === "GOAL_EXISTS") {
        await loadGoalFile();
        setDraftState({
          mode: "none",
        });
        return;
      }

      setDraftState({
        ...draftState,
        error: getApiErrorMessage(errorResponse, "Failed to save goal.md."),
        status: "editing",
      });
    } catch {
      setDraftState({
        ...draftState,
        error: "Failed to save goal.md. Confirm the backend is running.",
        status: "editing",
      });
    }
  }

  async function handleAgentRunStart() {
    if (
      (draftState.mode !== "agent-add" && draftState.mode !== "agent-edit") ||
      !goalAvailability.canRunGoalAction
    ) {
      return;
    }

    setDraftState({
      ...draftState,
      error: null,
      status: "starting",
    });

    try {
      const response = await fetch("/api/run/start", {
        body: JSON.stringify({
          autoCommit: false,
          provider: agentRunSelection.provider,
          model:
            agentRunSelection.provider === "codex"
              ? toRunModel(agentRunSelection.model)
              : null,
          prompt: buildAgentGoalPrompt(draftState.prompt),
          reasoningEffort:
            agentRunSelection.provider === "codex"
              ? toRunReasoningEffort(agentRunSelection.reasoningEffort)
              : null,
          claudeModel:
            agentRunSelection.provider === "claude"
              ? toRunClaudeModel(agentRunSelection.claudeModel)
              : null,
          piModel:
            agentRunSelection.provider === "pi"
              ? toRunPiModel(agentRunSelection.piModel)
              : null,
          review: {
            enabled: false,
          },
          runCount: 1,
          verificationCommands: [],
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const responseBody = (await response.json()) as
        | RunStartResponse
        | ApiErrorResponse;

      if (response.ok) {
        onRunnerStatusChange((responseBody as RunStartResponse).status);
        setDraftState({
          mode: "none",
        });
        return;
      }

      setDraftState({
        ...draftState,
        error: getApiErrorMessage(
          responseBody as ApiErrorResponse,
          "Failed to start goal agent run.",
        ),
        status: "editing",
      });
    } catch {
      setDraftState({
        ...draftState,
        error: "Failed to start goal agent run. Confirm the backend is running.",
        status: "editing",
      });
    }
  }

  function renderHeaderActions() {
    if (!goalActionLabels || isDraftActive) {
      return null;
    }

    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        {goalFileState.status === "available" ? (
          <Button
            aria-label={
              goalViewMode === "steps"
                ? "Show rendered document"
                : "Show implementation steps"
            }
            aria-pressed={goalViewMode === "steps"}
            onClick={() => {
              setGoalViewMode((currentMode) =>
                currentMode === "document" ? "steps" : "document",
              );
            }}
            size="sm"
            type="button"
            variant={goalViewMode === "steps" ? "secondary" : "outline"}
          >
            {goalViewMode === "steps" ? (
              <FileText
                aria-hidden="true"
                data-icon="inline-start"
                strokeWidth={2}
              />
            ) : (
              <ListChecks
                aria-hidden="true"
                data-icon="inline-start"
                strokeWidth={2}
              />
            )}
            {goalViewMode === "steps"
              ? "Rendered document"
              : "Implementation steps"}
          </Button>
        ) : null}
        <Button
          disabled={!goalAvailability.canRunGoalAction}
          onClick={handleManualStart}
          size="sm"
          type="button"
          variant="outline"
        >
          {goalActionStatus === "missing" ? (
            <FilePlus2
              aria-hidden="true"
              data-icon="inline-start"
              strokeWidth={2}
            />
          ) : (
            <Edit3
              aria-hidden="true"
              data-icon="inline-start"
              strokeWidth={2}
            />
          )}
          {goalActionLabels.manual}
        </Button>
        <Button
          disabled={!goalAvailability.canRunGoalAction}
          onClick={handleAgentStart}
          size="sm"
          type="button"
          variant="outline"
        >
          <Bot
            aria-hidden="true"
            data-icon="inline-start"
            strokeWidth={2}
          />
          {goalActionLabels.agent}
        </Button>
      </div>
    );
  }

  function renderDraftError(error: string | null) {
    if (!error) {
      return null;
    }

    return (
      <p
        className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive"
        role="alert"
      >
        {error}
      </p>
    );
  }

  function renderImplementationStepsView(steps: GoalImplementationStep[]) {
    if (steps.length === 0) {
      return (
        <p className="max-w-sm text-center text-sm leading-6 text-muted-foreground">
          No implementation steps found.
        </p>
      );
    }

    return (
      <div className="goal-steps-view min-h-full w-full">
        {steps.map((step) => (
          <div
            className="goal-step-box"
            data-status={step.status}
            key={step.id}
            style={
              {
                "--goal-step-indent": `${step.depth}rem`,
              } as CSSProperties
            }
          >
            <span
              aria-hidden="true"
              className="goal-step-status-dot"
            />
            <p>{step.text}</p>
          </div>
        ))}
      </div>
    );
  }

  function renderManualEditor() {
    if (draftState.mode !== "manual-add" && draftState.mode !== "manual-edit") {
      return null;
    }

    return (
      <div className="flex min-h-full w-full flex-col gap-3">
        <Textarea
          aria-label="goal.md markdown"
          className="min-h-[28rem] flex-1 resize-y font-mono text-xs leading-5"
          onChange={(event) => {
            setDraftState({
              ...draftState,
              markdown: event.target.value,
            });
          }}
          readOnly={goalAvailability.isDraftReadOnly}
          value={draftState.markdown}
        />
        {renderDraftError(draftState.error)}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            disabled={goalAvailability.isSaveDisabled}
            onClick={() => {
              void handleManualSave();
            }}
            type="button"
          >
            <Save
              aria-hidden="true"
              data-icon="inline-start"
              strokeWidth={2}
            />
            {draftState.status === "saving" ? "Saving..." : "Save"}
          </Button>
          <Button
            disabled={draftState.status === "saving"}
            onClick={handleDraftCancel}
            type="button"
            variant="outline"
          >
            <X
              aria-hidden="true"
              data-icon="inline-start"
              strokeWidth={2}
            />
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  function renderAgentEditor() {
    if (draftState.mode !== "agent-add" && draftState.mode !== "agent-edit") {
      return null;
    }

    return (
      <div className="flex min-h-full w-full flex-col gap-3">
        <Textarea
          aria-label="Goal agent request"
          className="min-h-40 resize-y leading-5"
          onChange={(event) => {
            setDraftState({
              ...draftState,
              prompt: event.target.value,
            });
          }}
          readOnly={goalAvailability.isDraftReadOnly}
          value={draftState.prompt}
        />
        {renderDraftError(draftState.error)}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            disabled={!goalAvailability.canRunGoalAction}
            onClick={() => {
              void handleAgentRunStart();
            }}
            type="button"
          >
            <Bot
              aria-hidden="true"
              data-icon="inline-start"
              strokeWidth={2}
            />
            {draftState.status === "starting" ? "Starting..." : "Start Agent"}
          </Button>
          <Button
            disabled={draftState.status === "starting"}
            onClick={handleDraftCancel}
            type="button"
            variant="outline"
          >
            <X
              aria-hidden="true"
              data-icon="inline-start"
              strokeWidth={2}
            />
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  function renderGoalPanelContent() {
    if (draftState.mode === "manual-add" || draftState.mode === "manual-edit") {
      return renderManualEditor();
    }

    if (draftState.mode === "agent-add" || draftState.mode === "agent-edit") {
      return renderAgentEditor();
    }

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

    if (goalFileState.status === "missing") {
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
              Add goal.md in the selected repository to control Codex runs from
              that repo.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex flex-wrap justify-center gap-2">
            <Button
              disabled={!goalAvailability.canRunGoalAction}
              onClick={handleManualStart}
              type="button"
            >
              <FilePlus2
                aria-hidden="true"
                data-icon="inline-start"
                strokeWidth={2}
              />
              Add
            </Button>
            <Button
              disabled={!goalAvailability.canRunGoalAction}
              onClick={handleAgentStart}
              type="button"
              variant="outline"
            >
              <Bot
                aria-hidden="true"
                data-icon="inline-start"
                strokeWidth={2}
              />
              Agent Add
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
      if (goalViewMode === "steps") {
        return renderImplementationStepsView(implementationSteps);
      }

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

  const isDocumentMode =
    goalFileState.status === "available" ||
    draftState.mode === "manual-add" ||
    draftState.mode === "manual-edit" ||
    draftState.mode === "agent-add" ||
    draftState.mode === "agent-edit";

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
        {renderHeaderActions() ?? (
          <CardDescription className="hidden min-w-0 max-w-[55%] truncate text-right text-xs font-medium sm:block sm:max-w-none">
            Rendered document
          </CardDescription>
        )}
      </CardHeader>
      <CardContent
        className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 py-10 data-[goal-available=true]:items-start data-[goal-available=true]:justify-start data-[goal-available=true]:py-4"
        data-goal-available={isDocumentMode}
      >
        {renderGoalPanelContent()}
      </CardContent>
    </Card>
  );
}
