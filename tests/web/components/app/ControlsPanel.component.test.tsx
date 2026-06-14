// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ControlsPanel } from "../../../../src/web/components/app/ControlsPanel";
import type { SkillInstallStatusResponse } from "../../../../src/web/api/responses";
import { createDefaultAgentRunSelection } from "../../../../src/web/runner/runSelection";

import { jsonResponse } from "./componentTestUtils";

const fetchMock = vi.fn();
const defaultSkillStatus: SkillInstallStatusResponse = {
  name: "goal-runner-framework",
  repoLocal: false,
  userGlobal: false,
  bundled: true,
  installed: false,
  paths: {
    repoLocal: "C:\\repo\\.agents\\skills\\goal-runner-framework\\SKILL.md",
    userGlobal:
      "C:\\Users\\tester\\.agents\\skills\\goal-runner-framework\\SKILL.md",
    bundled:
      "C:\\app\\bundled-skills\\goal-runner-framework\\SKILL.md",
  },
};

function mockFetchRoutes(
  routes: Record<string, unknown | { body: unknown; ok?: boolean; status?: number }>,
) {
  fetchMock.mockImplementation((input: string | URL | Request) => {
    const url = String(input);
    const route = routes[url];

    if (!route) {
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }

    if (
      typeof route === "object" &&
      route !== null &&
      "body" in route
    ) {
      const response = route as { body: unknown; ok?: boolean; status?: number };

      return Promise.resolve(
        jsonResponse(response.body, {
          ok: response.ok,
          status: response.status,
        }),
      );
    }

    return Promise.resolve(jsonResponse(route));
  });
}

function renderControls(
  overrides: Partial<ComponentProps<typeof ControlsPanel>> = {},
) {
  const props: ComponentProps<typeof ControlsPanel> = {
    agentRunSelection: createDefaultAgentRunSelection(),
    onRepositorySelected: vi.fn(),
    onAgentRunSelectionChange: vi.fn(),
    onRunnerStatusChange: vi.fn(),
    repositorySelection: {
      repositoryPath: "C:\\repo\\agent-goal-runner",
      status: "ready",
    },
    runnerStatus: "idle",
    ...overrides,
  };

  function ControlsHarness() {
    const [agentRunSelection, setAgentRunSelection] = useState(
      props.agentRunSelection,
    );

    return (
      <ControlsPanel
        {...props}
        agentRunSelection={agentRunSelection}
        onAgentRunSelectionChange={setAgentRunSelection}
      />
    );
  }

  const view = render(<ControlsHarness />);

  return {
    ...props,
    ...view,
  };
}

describe("ControlsPanel", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    mockFetchRoutes({
      "/api/skills/goal-runner-framework": defaultSkillStatus,
    });
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

  it("shows non-interactive provider guidance", () => {
    renderControls();

    expect(
      screen.getByText(
        /provider runs are non-interactive\. configure approvals, trust, sandboxing, and credentials/i,
      ),
    ).toBeTruthy();
  });

  it("selects a repository through the browse endpoint", async () => {
    const user = userEvent.setup();
    mockFetchRoutes({
      "/api/skills/goal-runner-framework": defaultSkillStatus,
      "/api/repository/browse": {
        cancelled: false,
        repositoryPath: "C:\\repo\\selected",
      },
    });
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

  it("renders goal-runner-framework skill status", async () => {
    renderControls();

    expect(screen.getByText("Skill")).toBeTruthy();
    expect(screen.getByText("Repo-local")).toBeTruthy();
    expect(screen.getByText("User-global")).toBeTruthy();
    expect(
      await screen.findByText(/goal-runner-framework is not installed/i),
    ).toBeTruthy();
  });

  it("installs the skill into the selected repository", async () => {
    const user = userEvent.setup();
    mockFetchRoutes({
      "/api/skills/goal-runner-framework": defaultSkillStatus,
      "/api/skills/goal-runner-framework/install/repo": {
        ...defaultSkillStatus,
        repoLocal: true,
        installed: true,
      },
    });
    renderControls();

    await user.click(await screen.findByRole("button", { name: /repo/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/skills/goal-runner-framework/install/repo",
        {
          method: "POST",
        },
      );
    });
    expect(screen.getAllByText("Installed").length).toBeGreaterThan(0);
  });

  it("installs the skill globally", async () => {
    const user = userEvent.setup();
    mockFetchRoutes({
      "/api/skills/goal-runner-framework": defaultSkillStatus,
      "/api/skills/goal-runner-framework/install/global": {
        ...defaultSkillStatus,
        userGlobal: true,
        installed: true,
      },
    });
    renderControls();

    await user.click(await screen.findByRole("button", { name: /global/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/skills/goal-runner-framework/install/global",
        {
          method: "POST",
        },
      );
    });
    expect(screen.getAllByText("Installed").length).toBeGreaterThan(0);
  });

  it("disables skill install actions while a run is active", async () => {
    renderControls({
      runnerStatus: "running",
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/skills/goal-runner-framework");
    });

    expect(screen.getByRole("button", { name: /repo/i })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: /global/i })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("clears stale installed skill status when a repository refresh fails", async () => {
    const firstStatus: SkillInstallStatusResponse = {
      ...defaultSkillStatus,
      installed: true,
      repoLocal: true,
      paths: {
        ...defaultSkillStatus.paths,
        repoLocal: "C:\\repo\\first\\.agents\\skills\\goal-runner-framework\\SKILL.md",
      },
    };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(firstStatus))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: "Status unavailable.",
          },
          {
            ok: false,
            status: 500,
          },
        ),
      );

    const view = renderControls({
      repositorySelection: {
        repositoryPath: "C:\\repo\\first",
        status: "ready",
      },
    });

    expect(await screen.findByText("Installed")).toBeTruthy();

    view.rerender(
      <ControlsPanel
        agentRunSelection={view.agentRunSelection}
        onAgentRunSelectionChange={view.onAgentRunSelectionChange}
        onRepositorySelected={view.onRepositorySelected}
        onRunnerStatusChange={view.onRunnerStatusChange}
        repositorySelection={{
          repositoryPath: "C:\\repo\\second",
          status: "ready",
        }}
        runnerStatus="idle"
      />,
    );

    await waitFor(() => {
      expect(screen.queryByText("Installed")).toBeNull();
    });
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Status unavailable.",
    );
  });

  it("shows repository browse validation errors", async () => {
    const user = userEvent.setup();
    mockFetchRoutes({
      "/api/skills/goal-runner-framework": defaultSkillStatus,
      "/api/repository/browse": {
        body: {
          error: "Selection failed.",
          issues: [{ message: "Pick a Git repository.", path: "path" }],
        },
        ok: false,
        status: 400,
      },
    });
    renderControls();

    await user.click(screen.getByRole("button", { name: /choose folder/i }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Selection failed.",
    );
    expect(screen.getByText("Pick a Git repository.")).toBeTruthy();
  });

  it("starts a run with normalized request settings", async () => {
    const user = userEvent.setup();
    mockFetchRoutes({
      "/api/skills/goal-runner-framework": defaultSkillStatus,
      "/api/run/start": {
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
      },
    });
    const props = renderControls();

    await user.type(
      screen.getByLabelText("Verification command 1"),
      " npm test ",
    );
    await user.click(screen.getByRole("button", { name: /^start$/i }));

    await waitFor(() => {
      expect(props.onRunnerStatusChange).toHaveBeenCalledWith("running");
    });

    const [, requestInit] = fetchMock.mock.calls.find(
      ([url]) => url === "/api/run/start",
    ) as [string, RequestInit];
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
      prompt: "Use goal.md as the source of truth.\n\nComplete the next valid unchecked step. Stop after completing one step.",
      reasoningEffort: "high",
      claudeModel: null,
      piModel: null,
      review: {
        enabled: false,
      },
      runCount: 1,
      verificationCommands: ["npm test"],
    });
  });

  it("forces auto-commit and includes review settings when review is enabled", async () => {
    const user = userEvent.setup();
    mockFetchRoutes({
      "/api/skills/goal-runner-framework": defaultSkillStatus,
      "/api/run/start": {
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
      },
    });
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

    const [, requestInit] = fetchMock.mock.calls.find(
      ([url]) => url === "/api/run/start",
    ) as [string, RequestInit];

    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      autoCommit: true,
      review: {
        enabled: true,
        intervalCommits: 3,
        model: "gpt-5.4",
        piModel: null,
        reasoningEffort: "high",
      },
    });
  });

  it("starts a Pi run with a free-text model", async () => {
    const user = userEvent.setup();
    mockFetchRoutes({
      "/api/skills/goal-runner-framework": defaultSkillStatus,
      "/api/run/start": {
        provider: "pi",
        model: null,
        reasoningEffort: null,
        claudeModel: null,
        piModel: "local/llama-3.1",
        review: {
          enabled: false,
          intervalCommits: 0,
          model: null,
          prompt: "",
          reasoningEffort: null,
          claudeModel: null,
          piModel: null,
        },
        status: "running",
      },
    });
    const props = renderControls();

    await user.click(screen.getByLabelText("Provider"));
    await user.click(await screen.findByRole("option", { name: "pi" }));
    await user.type(screen.getByLabelText("Pi model"), " local/llama-3.1 ");
    await user.click(screen.getByRole("button", { name: /^start$/i }));

    await waitFor(() => {
      expect(props.onRunnerStatusChange).toHaveBeenCalledWith("running");
    });

    const [, requestInit] = fetchMock.mock.calls.find(
      ([url]) => url === "/api/run/start",
    ) as [string, RequestInit];

    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      provider: "pi",
      model: null,
      reasoningEffort: null,
      claudeModel: null,
      piModel: "local/llama-3.1",
      review: {
        enabled: false,
      },
    });
  });

  it("stops a running run", async () => {
    const user = userEvent.setup();
    mockFetchRoutes({
      "/api/skills/goal-runner-framework": defaultSkillStatus,
      "/api/run/stop": {
        status: "stopped",
      },
    });
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
