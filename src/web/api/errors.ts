import type { ApiErrorResponse, ValidationIssue } from "@/web/api/responses";

export function formatRepositorySelectionError(
  errorResponse: ApiErrorResponse,
): {
  error: string;
  issues: ValidationIssue[];
} {
  const issues = Array.isArray(errorResponse.issues) ? errorResponse.issues : [];

  return {
    error: errorResponse.error ?? "Failed to select repository.",
    issues,
  };
}

export function formatApiError(
  errorResponse: ApiErrorResponse,
  fallback: string,
): {
  error: string;
  issues: ValidationIssue[];
} {
  const issues = Array.isArray(errorResponse.issues) ? errorResponse.issues : [];

  return {
    error: errorResponse.error ?? fallback,
    issues,
  };
}

export function getApiErrorMessage(
  errorResponse: ApiErrorResponse,
  fallback: string,
): string {
  return errorResponse.error ?? fallback;
}
