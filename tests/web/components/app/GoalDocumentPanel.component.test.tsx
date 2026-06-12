// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GoalDocumentPanel } from "../../../../src/web/components/app/GoalDocumentPanel";
import { DEFAULT_MANUAL_GOAL_MARKDOWN } from "../../../../src/web/goal/goalEditing";
import { createDefaultAgentRunSelection } from "../../../../src/web/runner/runSelection";

import { jsonResponse } from "./componentTestUtils";

const fetchMock = vi.fn();

function goalResponse(markdown: string) {
  return {
    goalPath: "C:\\repo\\agent-goal-runner\\goal.md",
    markdown,
    repositoryPath: "C:\\repo\\agent-goal-runner",
    revision: "rev-1",
  };
}

function renderGoalPanel(
  overrides: Partial<ComponentProps<typeof GoalDocumentPanel>> = {},
) {
  const props: ComponentProps<typeof GoalDocumentPanel> = {
    agentRunSelection: createDefaultAgentRunSelection(),
    goalRefreshToken: 0,
    onRunnerStatusChange: vi.fn(),
    repositorySelection: {
      repositoryPath: "C:\\repo\\agent-goal-runner",
      status: "ready",
    },
    runnerStatus: "idle",
    ...overrides,
  };

  render(<GoalDocumentPanel {...props} />);

  return props;
}

describe("GoalDocumentPanel", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("asks for a repository before loading goal.md", () => {
    renderGoalPanel({
      repositorySelection: {
        repositoryPath: null,
        status: "ready",
      },
    });

    expect(
      screen.getByText("Select a repository to view its goal.md."),
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders a missing goal.md state and saves a manual draft", async () => {
    const user = userEvent.setup();
    const savedMarkdown = [
      "# Project Goal",
      "",
      "## Implementation Plan",
      "",
      "- [ ] Add coverage",
    ].join("\n");
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          {
            code: "GOAL_MISSING",
            error: "No goal.md found.",
          },
          { ok: false, status: 404 },
        ),
      )
      .mockResolvedValueOnce(jsonResponse(goalResponse(savedMarkdown)));

    renderGoalPanel();

    expect(await screen.findByText("No goal.md found")).toBeTruthy();

    await user.click(screen.getAllByRole("button", { name: "Add" })[0]);

    const editor = screen.getByLabelText("goal.md markdown");

    expect(editor).toHaveProperty("value", DEFAULT_MANUAL_GOAL_MARKDOWN);

    fireEvent.change(editor, {
      target: {
        value: savedMarkdown,
      },
    });
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(screen.getByText("Project Goal")).toBeTruthy();
    });

    const [, requestInit] = fetchMock.mock.calls[1] as [string, RequestInit];

    expect(fetchMock.mock.calls[1][0]).toBe("/api/goal");
    expect(requestInit.method).toBe("POST");
    expect(JSON.parse(String(requestInit.body))).toEqual({
      markdown: savedMarkdown,
    });
  });

  it("renders an available goal and toggles to implementation steps", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        goalResponse([
          "# Project Goal",
          "",
          "Build the runner.",
          "",
          "## Implementation Plan",
          "",
          "- [x] Existing task",
          "- [ ] Next task",
        ].join("\n")),
      ),
    );

    renderGoalPanel();

    expect(await screen.findByText("Build the runner.")).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: "Show implementation steps" }),
    );

    expect(screen.getByText("Existing task")).toBeTruthy();
    expect(screen.getByText("Next task")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Show rendered document" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("starts an agent goal run from the missing-goal state", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          {
            code: "GOAL_MISSING",
            error: "No goal.md found.",
          },
          { ok: false, status: 404 },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          model: null,
          reasoningEffort: null,
          review: {
            enabled: false,
            intervalCommits: 0,
            model: null,
            prompt: "",
            reasoningEffort: null,
          },
          status: "running",
        }),
      );
    const props = renderGoalPanel();

    expect(await screen.findByText("No goal.md found")).toBeTruthy();

    await user.click(screen.getAllByRole("button", { name: "Agent Add" })[0]);
    await user.clear(screen.getByLabelText("Goal agent request"));
    await user.type(screen.getByLabelText("Goal agent request"), "Draft goal.md");
    await user.click(screen.getByRole("button", { name: "Start Agent" }));

    await waitFor(() => {
      expect(props.onRunnerStatusChange).toHaveBeenCalledWith("running");
    });

    const [, requestInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const requestBody = JSON.parse(String(requestInit.body));

    expect(fetchMock.mock.calls[1][0]).toBe("/api/run/start");
    expect(requestBody).toMatchObject({
      autoCommit: false,
      provider: "codex",
      model: "gpt-5.4",
      reasoningEffort: "high",
      claudeModel: null,
      piModel: null,
      review: {
        enabled: false,
      },
      runCount: 1,
      verificationCommands: [],
    });
    expect(requestBody.prompt).toContain(
      "Use the `goal-runner-framework` skill.",
    );
    expect(requestBody.prompt).toContain("User request:\nDraft goal.md");
  });

  it("starts an agent goal run with the selected Pi provider", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          {
            code: "GOAL_MISSING",
            error: "No goal.md found.",
          },
          { ok: false, status: 404 },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          provider: "pi",
          model: null,
          reasoningEffort: null,
          claudeModel: null,
          piModel: "local/llama-3.1",
          review: {
            enabled: false,
          },
          status: "running",
        }),
      );

    renderGoalPanel({
      agentRunSelection: {
        ...createDefaultAgentRunSelection(),
        provider: "pi",
        piModel: " local/llama-3.1 ",
      },
    });

    expect(await screen.findByText("No goal.md found")).toBeTruthy();

    await user.click(screen.getAllByRole("button", { name: "Agent Add" })[0]);
    await user.click(screen.getByRole("button", { name: "Start Agent" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/run/start",
        expect.any(Object),
      );
    });

    const [, requestInit] = fetchMock.mock.calls[1] as [string, RequestInit];

    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      provider: "pi",
      model: null,
      reasoningEffort: null,
      claudeModel: null,
      piModel: "local/llama-3.1",
    });
  });

  it("shows a load error when goal.md cannot be fetched", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    renderGoalPanel();

    expect(await screen.findByText("goal.md unavailable")).toBeTruthy();
    expect(
      screen.getByText("Failed to load goal.md. Confirm the backend is running."),
    ).toBeTruthy();
  });
});
