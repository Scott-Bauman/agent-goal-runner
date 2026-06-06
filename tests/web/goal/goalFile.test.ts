import { describe, expect, it } from "vitest";

import {
  getGoalFileLoadStartState,
  type GoalFileState,
} from "../../../src/web/goal/goalFile";

const availableGoalState: GoalFileState = {
  status: "available",
  error: null,
  goalPath: "C:\\repo-a\\goal.md",
  markdown: "# Repo A",
  repositoryPath: "C:\\repo-a",
  revision: "revision-a",
};

function expectLoadingGoalState(state: GoalFileState) {
  expect(state).toEqual({
    status: "loading",
    error: null,
    goalPath: null,
    markdown: null,
    repositoryPath: null,
    revision: null,
  });
}

describe("goal file load state", () => {
  it("uses loading state for the initial selected repository load", () => {
    const initialState: GoalFileState = {
      status: "idle",
      error: null,
      goalPath: null,
      markdown: null,
      repositoryPath: null,
      revision: null,
    };

    expectLoadingGoalState(
      getGoalFileLoadStartState({
        currentState: initialState,
        selectedRepositoryPath: "C:\\repo-a",
      }),
    );
  });

  it("preserves available markdown while refreshing the same repository", () => {
    expect(
      getGoalFileLoadStartState({
        currentState: availableGoalState,
        selectedRepositoryPath: "C:\\repo-a",
      }),
    ).toBe(availableGoalState);
  });

  it("does not preserve markdown when switching repositories", () => {
    expectLoadingGoalState(
      getGoalFileLoadStartState({
        currentState: availableGoalState,
        selectedRepositoryPath: "C:\\repo-b",
      }),
    );
  });

  it("uses loading state when refreshing from missing or error states", () => {
    const missingState: GoalFileState = {
      status: "missing",
      error: null,
      goalPath: null,
      markdown: null,
      repositoryPath: null,
      revision: null,
    };
    const errorState: GoalFileState = {
      status: "error",
      error: "Failed to load goal.md.",
      goalPath: null,
      markdown: null,
      repositoryPath: null,
      revision: null,
    };

    expectLoadingGoalState(
      getGoalFileLoadStartState({
        currentState: missingState,
        selectedRepositoryPath: "C:\\repo-a",
      }),
    );
    expectLoadingGoalState(
      getGoalFileLoadStartState({
        currentState: errorState,
        selectedRepositoryPath: "C:\\repo-a",
      }),
    );
  });
});
