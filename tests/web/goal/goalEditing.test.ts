import { describe, expect, it } from "vitest";

import {
  buildAgentGoalPrompt,
  getGoalDocumentActionLabels,
  getGoalDocumentAvailability,
} from "../../../src/web/goal/goalEditing";

describe("goal document editing helpers", () => {
  it("switches action labels for missing and available goal.md states", () => {
    expect(getGoalDocumentActionLabels("missing")).toEqual({
      agent: "Agent Add",
      manual: "Add",
    });
    expect(getGoalDocumentActionLabels("available")).toEqual({
      agent: "Agent Edit",
      manual: "Edit",
    });
  });

  it("disables goal editing controls while the runner is active", () => {
    expect(
      getGoalDocumentAvailability({
        isSaving: false,
        runnerStatus: "running",
      }),
    ).toEqual({
      canRunGoalAction: false,
      isDraftReadOnly: true,
      isSaveDisabled: true,
    });
    expect(
      getGoalDocumentAvailability({
        isSaving: false,
        runnerStatus: "idle",
      }),
    ).toEqual({
      canRunGoalAction: true,
      isDraftReadOnly: false,
      isSaveDisabled: false,
    });
  });

  it("builds agent prompts with goal-runner-framework and root-only constraints", () => {
    const prompt = buildAgentGoalPrompt("Add a verification checklist.");

    expect(prompt.startsWith("Use the `goal-runner-framework` skill.")).toBe(true);
    expect(prompt).toContain("selected repository root `goal.md`");
    expect(prompt).toContain("Preserve completed checkboxes");
    expect(prompt).toContain("Do not implement project code.");
    expect(prompt).toContain("Do not mutate unrelated files.");
    expect(prompt).toContain("User request:\nAdd a verification checklist.");
  });
});
