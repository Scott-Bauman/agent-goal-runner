export type GoalFileResponse = {
  exists?: boolean;
  goalPath: string;
  markdown: string;
  repositoryPath: string;
  revision: string;
};

export type GoalFileState =
  | {
      status: "idle" | "loading" | "available" | "missing" | "creating";
      error: null;
      goalPath: string | null;
      markdown: string | null;
      repositoryPath: string | null;
      revision: string | null;
    }
  | {
      status: "error";
      error: string;
      goalPath: null;
      markdown: null;
      repositoryPath: null;
      revision: null;
    };

function createLoadingGoalFileState(): GoalFileState {
  return {
    status: "loading",
    error: null,
    goalPath: null,
    markdown: null,
    repositoryPath: null,
    revision: null,
  };
}

export function getGoalFileLoadStartState({
  currentState,
  selectedRepositoryPath,
}: {
  currentState: GoalFileState;
  selectedRepositoryPath: string;
}): GoalFileState {
  if (
    currentState.status === "available" &&
    currentState.markdown !== null &&
    currentState.repositoryPath === selectedRepositoryPath
  ) {
    return currentState;
  }

  return createLoadingGoalFileState();
}
