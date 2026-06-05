import { describe, expect, it } from "vitest";

import { getRepositoryLabel } from "../../../src/web/repository/repositorySelection";

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
});
