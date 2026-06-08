import type { RepositoryBranchesResponse } from "@/web/api/responses";
import type { RepositorySelectionState } from "@/web/repository/repositorySelection";

export function shouldShowBranchSelector(
  repositorySelection: RepositorySelectionState,
): boolean {
  return (
    repositorySelection.status === "ready" &&
    repositorySelection.repositoryPath !== null
  );
}

export function getWorkingTreeStatusLabel(
  status: RepositoryBranchesResponse["workingTreeStatus"],
): string {
  if (status === "changes") {
    return "Changes";
  }

  if (status === "clean") {
    return "Clean";
  }

  return "Unknown";
}

export function getBranchMergeSuccessDescription(
  mergedBranch: string,
  currentBranch: string | null,
): string {
  return `Merged "${mergedBranch}" into "${currentBranch ?? "current branch"}".`;
}
