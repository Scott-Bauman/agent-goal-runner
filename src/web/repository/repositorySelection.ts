import { formatRepositorySelectionError } from "@/web/api/errors";
import type {
  ApiErrorResponse,
  RepositoryBrowseResponse,
  ValidationIssue,
} from "@/web/api/responses";

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

export type RepositoryBrowseResult =
  | {
      status: "selected";
      repositoryPath: string;
    }
  | {
      status: "cancelled";
    }
  | {
      status: "error";
      error: string;
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

export function getRepositoryBrowseResult(
  responseOk: boolean,
  responseBody: RepositoryBrowseResponse | ApiErrorResponse,
): RepositoryBrowseResult {
  if (!responseOk) {
    const formattedError = formatRepositorySelectionError(
      responseBody as ApiErrorResponse,
    );

    return {
      status: "error",
      error: formattedError.error,
      issues: formattedError.issues,
    };
  }

  const browseResponse = responseBody as RepositoryBrowseResponse;

  if (browseResponse.cancelled) {
    return {
      status: "cancelled",
    };
  }

  if (!browseResponse.repositoryPath) {
    return {
      status: "error",
      error: "Repository selection response did not include a path.",
      issues: [],
    };
  }

  return {
    status: "selected",
    repositoryPath: browseResponse.repositoryPath,
  };
}
