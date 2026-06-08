import {
  getRepositoryLabel,
  type RepositorySelectionState,
} from "@/web/repository/repositorySelection";

export function getRepositoryFolderLabel(
  repositorySelection: RepositorySelectionState,
) {
  if (
    repositorySelection.status !== "ready" ||
    repositorySelection.repositoryPath === null
  ) {
    return getRepositoryLabel(repositorySelection);
  }

  return getFolderName(repositorySelection.repositoryPath);
}

function getFolderName(repositoryPath: string) {
  const trimmedPath = repositoryPath.replace(/[\\/]+$/, "");
  const pathParts = trimmedPath.split(/[\\/]/);

  return pathParts[pathParts.length - 1] || repositoryPath;
}
