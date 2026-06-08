import { describe, expect, it } from "vitest";

import {
  getBranchMergeSuccessDescription,
  shouldShowBranchSelector,
  getWorkingTreeStatusLabel,
} from "../../../../src/web/components/app/topBarGit";
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

  it("formats working tree status labels", () => {
    expect(getWorkingTreeStatusLabel("clean")).toBe("Clean");
    expect(getWorkingTreeStatusLabel("changes")).toBe("Changes");
    expect(getWorkingTreeStatusLabel("unknown")).toBe("Unknown");
  });

  it("formats successful merge feedback", () => {
    expect(getBranchMergeSuccessDescription("feature/git-ui", "main")).toBe(
      'Merged "feature/git-ui" into "main".',
    );
    expect(getBranchMergeSuccessDescription("feature/git-ui", null)).toBe(
      'Merged "feature/git-ui" into "current branch".',
    );
  });
});
