import type { ValidationIssue } from "@/web/api/responses";

export type RepositorySelectionState =
  | {
      status: "loading";
      repositoryPath: null;
    }
  | {
      status: "ready";
      repositoryPath: string | null;
    }
  | {
      status: "error";
      repositoryPath: null;
    };

export type RepositoryPathFormState = {
  status: "idle" | "submitting";
  error: string | null;
  issues: ValidationIssue[];
};

export function getRepositoryLabel(
  repositorySelection: RepositorySelectionState,
) {
  return repositorySelection.status === "loading"
    ? "Loading repository..."
    : repositorySelection.status === "error"
      ? "Repository unavailable"
      : (repositorySelection.repositoryPath ?? "No repository selected");
}
