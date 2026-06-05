import { describe, expect, it } from "vitest";

import {
  formatApiError,
  formatRepositorySelectionError,
  getApiErrorMessage,
} from "../../../src/web/api/errors";
import type { ApiErrorResponse } from "../../../src/web/api/responses";

describe("frontend API error helpers", () => {
  it("formats repository selection errors with provided issues", () => {
    const issue = {
      message: "Path must be a git repository.",
      path: "path",
    };

    expect(
      formatRepositorySelectionError({
        error: "Repository rejected.",
        issues: [issue],
      }),
    ).toEqual({
      error: "Repository rejected.",
      issues: [issue],
    });
  });

  it("uses the repository selection fallback when no error message is present", () => {
    expect(formatRepositorySelectionError({})).toEqual({
      error: "Failed to select repository.",
      issues: [],
    });
  });

  it("formats generic API errors with fallback text and ignores malformed issues", () => {
    const response = {
      error: undefined,
      issues: "not a validation issue array",
    } as unknown as ApiErrorResponse;

    expect(formatApiError(response, "Failed to start run.")).toEqual({
      error: "Failed to start run.",
      issues: [],
    });
  });

  it("returns the API error message when present", () => {
    expect(
      getApiErrorMessage(
        {
          error: "goal.md unavailable.",
        },
        "Failed to load goal.md.",
      ),
    ).toBe("goal.md unavailable.");
  });

  it("returns the fallback API error message when no error is present", () => {
    expect(getApiErrorMessage({}, "Failed to load goal.md.")).toBe(
      "Failed to load goal.md.",
    );
  });
});
