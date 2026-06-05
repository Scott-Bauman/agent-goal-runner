import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, FilePlus2, FileText } from "lucide-react";

import { getApiErrorMessage } from "@/web/api/errors";
import type { ApiErrorResponse } from "@/web/api/responses";
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
import type { GoalFileResponse, GoalFileState } from "@/web/goal/goalFile";
import { renderGoalMarkdown } from "@/web/markdown";
import type { RepositorySelectionState } from "@/web/repository/repositorySelection";

export function GoalDocumentPanel({
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
