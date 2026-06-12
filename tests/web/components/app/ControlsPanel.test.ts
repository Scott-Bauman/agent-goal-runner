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
      provider: "codex",
      intervalCommits: 3,
      model: "gpt-5.4-nano",
      prompt: "Use $review.",
      reasoningEffort: "low",
      claudeModel: null,
      piModel: null,
    });
  });

  it("creates an enabled Claude review request with the Claude model only", () => {
    expect(
      createReviewRunRequest({
        intervalCommits: 1,
        provider: "claude",
        model: "gpt-5.4",
        prompt: "Review recent commits.",
        reasoningEffort: "high",
        claudeModel: "opus",
        reviewEnabled: true,
      }),
    ).toEqual({
      enabled: true,
      provider: "claude",
      intervalCommits: 1,
      model: null,
      prompt: "Review recent commits.",
      reasoningEffort: null,
      claudeModel: "opus",
      piModel: null,
    });
  });

  it("creates an enabled Pi review request with the Pi model only", () => {
    expect(
      createReviewRunRequest({
        intervalCommits: 2,
        provider: "pi",
        model: "gpt-5.4",
        prompt: "Review recent commits.",
        reasoningEffort: "high",
        claudeModel: "opus",
        piModel: "llama-3.1",
        reviewEnabled: true,
      }),
    ).toEqual({
      enabled: true,
      provider: "pi",
      intervalCommits: 2,
      model: null,
      prompt: "Review recent commits.",
      reasoningEffort: null,
      claudeModel: null,
      piModel: "llama-3.1",
    });
  });
});
