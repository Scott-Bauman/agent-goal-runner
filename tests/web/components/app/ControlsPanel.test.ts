import { describe, expect, it } from "vitest";

import {
  createDefaultReviewPrompt,
  createReviewRunRequest,
  getAutoCommitForReview,
  isReviewSettingsVisible,
} from "../../../../src/web/components/app/controlsPanelReview";

describe("ControlsPanel review setup helpers", () => {
  it("hides review settings when review is disabled", () => {
    expect(isReviewSettingsVisible(false)).toBe(false);
  });

  it("shows review settings when review is enabled", () => {
    expect(isReviewSettingsVisible(true)).toBe(true);
  });

  it("forces auto-commit when review is enabled", () => {
    expect(getAutoCommitForReview(true, false)).toBe(true);
    expect(getAutoCommitForReview(true, true)).toBe(true);
    expect(getAutoCommitForReview(false, false)).toBe(false);
  });

  it("creates a default review prompt from the selected interval", () => {
    expect(createDefaultReviewPrompt(3)).toBe(
      "Review the last 3 commits for bugs, regressions, and missed requirements. Fix any issues you find, then report what you changed.",
    );
  });

  it("creates a disabled review request without hidden settings", () => {
    expect(
      createReviewRunRequest({
        intervalCommits: 3,
        model: "gpt-5.4",
        prompt: "Review recent commits.",
        reasoningEffort: "high",
        reviewEnabled: false,
      }),
    ).toEqual({
      enabled: false,
    });
  });

  it("creates a normalized enabled review request", () => {
    expect(
      createReviewRunRequest({
        intervalCommits: 3,
        model: "gpt-5.4-nano",
        prompt: "Use the review skill.",
        reasoningEffort: "low",
        reviewEnabled: true,
      }),
    ).toEqual({
      enabled: true,
      intervalCommits: 3,
      model: "gpt-5.4-nano",
      prompt: "Use $review.",
      reasoningEffort: "low",
    });
  });
});
