// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ControlsPanel } from "../../../../src/web/components/app/ControlsPanel";

import { jsonResponse } from "./componentTestUtils";

const fetchMock = vi.fn();

function renderControls(
  overrides: Partial<ComponentProps<typeof ControlsPanel>> = {},
) {
  const props: ComponentProps<typeof ControlsPanel> = {
    onRepositorySelected: vi.fn(),
    onRunnerStatusChange: vi.fn(),
    repositorySelection: {
      repositoryPath: "C:\\repo\\agent-goal-runner",
      status: "ready",
    },
    runnerStatus: "idle",
    ...overrides,
  };

  render(<ControlsPanel {...props} />);

  return props;
}

describe("ControlsPanel", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("disables run actions until a repository is selected", () => {
    renderControls({
      repositorySelection: {
        repositoryPath: null,
        status: "ready",
      },
    });

    expect(screen.getByRole("button", { name: /start/i })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: /stop/i })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByText("Repository")).toBeTruthy();
    expect(screen.getAllByText("Prompt").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Provider").length).toBeGreaterThan(0);
    expect(screen.getByText("Codex model")).toBeTruthy();
    expect(screen.getAllByText("Verification").length).toBeGreaterThan(0);
  });

  it("selects a repository through the browse endpoint", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        cancelled: false,
        repositoryPath: "C:\\repo\\selected",
      }),
    );
    const props = renderControls({
      repositorySelection: {
        repositoryPath: null,
        status: "ready",
      },
    });

    await user.click(screen.getByRole("button", { name: /choose folder/i }));

    await waitFor(() => {
      expect(props.onRepositorySelected).toHaveBeenCalledWith(
        "C:\\repo\\selected",
      );
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/repository/browse", {
      method: "POST",
    });
  });

  it("shows repository browse validation errors", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: "Selection failed.",
          issues: [{ message: "Pick a Git repository.", path: "path" }],
        },
        { ok: false, status: 400 },
      ),
    );
    renderControls();

    await user.click(screen.getByRole("button", { name: /choose folder/i }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Selection failed.",
    );
    expect(screen.getByText("Pick a Git repository.")).toBeTruthy();
  });

  it("starts a run with normalized request settings", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        model: "gpt-5.4",
        reasoningEffort: "high",
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
    const props = renderControls();

    await user.type(
      screen.getByLabelText("Verification command 1"),
      " npm test ",
    );
    await user.click(screen.getByRole("button", { name: /^start$/i }));

    await waitFor(() => {
      expect(props.onRunnerStatusChange).toHaveBeenCalledWith("running");
    });

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/run/start",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(JSON.parse(String(requestInit.body))).toEqual({
      autoCommit: false,
      provider: "codex",
      model: "gpt-5.4",
      prompt: "Use goal.md as the source of truth.\n\nComplete the next valid unchecked item.",
      reasoningEffort: "high",
      claudeModel: null,
      review: {
        enabled: false,
      },
      runCount: 1,
      verificationCommands: ["npm test"],
    });
  });

  it("forces auto-commit and includes review settings when review is enabled", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        model: "gpt-5.4",
        reasoningEffort: "high",
        review: {
          enabled: true,
          intervalCommits: 3,
          model: "gpt-5.4",
          prompt: "Review",
          reasoningEffort: "high",
        },
        status: "running",
      }),
    );
    renderControls();

    await user.click(screen.getByRole("switch", { name: "Review" }));

    expect(screen.getByRole("switch", { name: "Auto-commit" })).toHaveProperty(
      "disabled",
      true,
    );

    await user.click(screen.getByRole("button", { name: /^start$/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/run/start",
        expect.any(Object),
      );
    });

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      autoCommit: true,
      review: {
        enabled: true,
        intervalCommits: 3,
        model: "gpt-5.4",
        reasoningEffort: "high",
      },
    });
  });

  it("stops a running run", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "stopped" }));
    const props = renderControls({
      runnerStatus: "running",
    });

    await user.click(screen.getByRole("button", { name: /^stop$/i }));

    await waitFor(() => {
      expect(props.onRunnerStatusChange).toHaveBeenCalledWith("stopped");
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/run/stop", {
      method: "POST",
    });
  });
});
