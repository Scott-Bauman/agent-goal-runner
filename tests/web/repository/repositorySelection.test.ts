import { describe, expect, it } from "vitest";

import {
  getRepositoryBrowseResult,
  getRepositoryLabel,
} from "../../../src/web/repository/repositorySelection";

describe("repository selection frontend helpers", () => {
  it("formats the loading repository label", () => {
    expect(
      getRepositoryLabel({
        status: "loading",
        repositoryPath: null,
      }),
    ).toBe("Loading repository...");
  });

  it("formats the error repository label", () => {
    expect(
      getRepositoryLabel({
        status: "error",
        repositoryPath: null,
      }),
    ).toBe("Repository unavailable");
  });

  it("formats the selected repository path", () => {
    expect(
      getRepositoryLabel({
        status: "ready",
        repositoryPath: "C:\\repo",
      }),
    ).toBe("C:\\repo");
  });

  it("formats the ready state with no selected repository", () => {
    expect(
      getRepositoryLabel({
        status: "ready",
        repositoryPath: null,
      }),
    ).toBe("No repository selected");
  });

  it("handles a successful repository browse response", () => {
    expect(
      getRepositoryBrowseResult(true, {
        cancelled: false,
        repositoryPath: "C:\\repo",
      }),
    ).toEqual({
      status: "selected",
      repositoryPath: "C:\\repo",
    });
  });

  it("handles a cancelled repository browse response", () => {
    expect(
      getRepositoryBrowseResult(true, {
        cancelled: true,
        repositoryPath: null,
      }),
    ).toEqual({
      status: "cancelled",
    });
  });

  it("handles repository browse validation errors", () => {
    expect(
      getRepositoryBrowseResult(false, {
        error: "Invalid repository selection request.",
        code: "VALIDATION_ERROR",
        issues: [
          {
            path: "path",
            message: "Path must be a git repository.",
          },
        ],
      }),
    ).toEqual({
      status: "error",
      error: "Invalid repository selection request.",
      issues: [
        {
          path: "path",
          message: "Path must be a git repository.",
        },
      ],
    });
  });

  it("handles malformed repository browse success responses", () => {
    expect(
      getRepositoryBrowseResult(true, {
        cancelled: false,
        repositoryPath: null,
      }),
    ).toEqual({
      status: "error",
      error: "Repository selection response did not include a path.",
      issues: [],
    });
  });
});
