// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OperationsWorkspace } from "../../../../src/web/components/app/OperationsWorkspace";

import {
  createRuntimeStreamState,
  renderWithSidebar,
} from "./componentTestUtils";

describe("OperationsWorkspace", () => {
  it("composes run setup, goal, and log panels", () => {
    renderWithSidebar(
      <OperationsWorkspace
        commandActionsTargetId="run-actions"
        goalRefreshToken={0}
        onClearOutput={vi.fn()}
        onRepositorySelected={vi.fn()}
        onRunnerStatusChange={vi.fn()}
        repositorySelection={{
          repositoryPath: null,
          status: "ready",
        }}
        runnerStatus="idle"
        runtimeStream={createRuntimeStreamState()}
      />,
    );

    expect(screen.getAllByText("Run setup").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Repository").length).toBeGreaterThan(0);
    expect(screen.getByText("goal.md")).toBeTruthy();
    expect(screen.getByText("Agent Output")).toBeTruthy();
    expect(
      screen.getByText("Select a repository to view its goal.md."),
    ).toBeTruthy();
  });
});
