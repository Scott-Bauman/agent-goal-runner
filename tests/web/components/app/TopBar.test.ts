import { describe, expect, it } from "vitest";

import { shouldShowBranchSelector } from "../../../../src/web/components/app/TopBar";
import { getRepositoryFolderLabel } from "../../../../src/web/repository/repositoryPath";

describe("TopBar helpers", () => {
  it("formats the selected repository as a folder name without the full path", () => {
    expect(
      getRepositoryFolderLabel({
        status: "ready",
        repositoryPath: "C:\\Users\\Scott\\agent-goal-runner",
      }),
    ).toBe("agent-goal-runner");
  });

  it("uses the repository selection label when no repository is selected", () => {
    expect(
      getRepositoryFolderLabel({
        status: "ready",
        repositoryPath: null,
      }),
    ).toBe("No repository selected");
  });

  it("hides the branch selector when no repository is selected", () => {
    expect(
      shouldShowBranchSelector({
        status: "ready",
        repositoryPath: null,
      }),
    ).toBe(false);
  });

  it("shows the branch selector when a repository is selected", () => {
    expect(
      shouldShowBranchSelector({
        status: "ready",
        repositoryPath: "C:\\Users\\Scott\\agent-goal-runner",
      }),
    ).toBe(true);
  });
});
