// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TopBar } from "../../../../src/web/components/app/TopBar";

import { jsonResponse } from "./componentTestUtils";

const fetchMock = vi.fn();

function renderTopBar(overrides: Partial<ComponentProps<typeof TopBar>> = {}) {
  const props: ComponentProps<typeof TopBar> = {
    actionSlotId: "run-actions",
    connectionStatus: "connecting",
    repositorySelection: {
      repositoryPath: null,
      status: "ready",
    },
    status: "idle",
    ...overrides,
  };

  render(<TopBar {...props} />);

  return props;
}

describe("TopBar", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("renders app status, selected repository label, and action slot", () => {
    renderTopBar({
      connectionStatus: "open",
    });

    expect(screen.getByText("Agent Goal Runner")).toBeTruthy();
    expect(screen.getByText("No repository selected")).toBeTruthy();
    expect(
      screen.getByRole("status", { name: "SSE connection: SSE Stream Open" }),
    ).toBeTruthy();
    expect(document.getElementById("run-actions")).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("toggles and persists the theme", async () => {
    const user = userEvent.setup();

    renderTopBar();

    await user.click(
      screen.getByRole("button", { name: "Switch to dark mode" }),
    );

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(window.localStorage.getItem("agent-goal-runner-theme")).toBe("dark");
    expect(
      screen.getByRole("button", { name: "Switch to light mode" }),
    ).toBeTruthy();
  });

  it("loads branches for a selected repository", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        branches: ["main", "feature/test"],
        currentBranch: "main",
        workingTreeStatus: "changes",
      }),
    );

    renderTopBar({
      repositorySelection: {
        repositoryPath: "C:\\repo\\agent-goal-runner",
        status: "ready",
      },
    });

    expect(screen.getByText("agent-goal-runner")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByLabelText("Git branch")).toHaveProperty(
        "value",
        "main",
      );
    });
    expect(screen.getByText("Changes")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/repository/branches",
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("refreshes branch state after initial load", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          branches: ["main"],
          currentBranch: "main",
          workingTreeStatus: "clean",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          branches: ["main", "feature/refreshed"],
          currentBranch: "feature/refreshed",
          workingTreeStatus: "clean",
        }),
      );

    renderTopBar({
      repositorySelection: {
        repositoryPath: "C:\\repo\\agent-goal-runner",
        status: "ready",
      },
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Git branch")).toHaveProperty(
        "value",
        "main",
      );
    });

    await user.click(
      screen.getByRole("button", { name: "Refresh Git branches" }),
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Git branch")).toHaveProperty(
        "value",
        "feature/refreshed",
      );
    });
  });

  it("switches and creates branches from the branch selector", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          branches: ["main", "feature/test"],
          currentBranch: "main",
          workingTreeStatus: "clean",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          branches: ["main", "feature/test"],
          currentBranch: "feature/test",
          workingTreeStatus: "clean",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          branches: ["main", "feature/test", "feature/new"],
          currentBranch: "feature/new",
          workingTreeStatus: "clean",
        }),
      );

    renderTopBar({
      repositorySelection: {
        repositoryPath: "C:\\repo\\agent-goal-runner",
        status: "ready",
      },
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Git branch")).toHaveProperty(
        "value",
        "main",
      );
    });

    await user.click(screen.getByLabelText("Git branch"));
    await user.click(await screen.findByText("feature/test"));

    await waitFor(() => {
      expect(screen.getByLabelText("Git branch")).toHaveProperty(
        "value",
        "feature/test",
      );
    });

    await user.click(screen.getByLabelText("Git branch"));
    await user.type(
      await screen.findByLabelText("New branch name"),
      "feature/new",
    );
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Git branch")).toHaveProperty(
        "value",
        "feature/new",
      );
    });

    const switchRequest = fetchMock.mock.calls[1] as [string, RequestInit];
    const createRequest = fetchMock.mock.calls[2] as [string, RequestInit];

    expect(switchRequest[0]).toBe("/api/repository/branches/switch");
    expect(JSON.parse(String(switchRequest[1].body))).toEqual({
      branch: "feature/test",
    });
    expect(createRequest[0]).toBe("/api/repository/branches");
    expect(JSON.parse(String(createRequest[1].body))).toEqual({
      name: "feature/new",
    });
  });

  it("merges and deletes non-current branches", async () => {
    const user = userEvent.setup();
    const confirmMock = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmMock);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          branches: ["main", "feature/test"],
          currentBranch: "main",
          workingTreeStatus: "clean",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          branches: ["main", "feature/test"],
          currentBranch: "main",
          workingTreeStatus: "clean",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          branches: ["main"],
          currentBranch: "main",
          workingTreeStatus: "clean",
        }),
      );

    renderTopBar({
      repositorySelection: {
        repositoryPath: "C:\\repo\\agent-goal-runner",
        status: "ready",
      },
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Git branch")).toHaveProperty(
        "value",
        "main",
      );
    });

    await user.click(screen.getByLabelText("Git branch"));
    await user.click(
      await screen.findByRole("button", {
        name: "Merge feature/test into current branch",
      }),
    );

    expect(await screen.findByText("Merge successful")).toBeTruthy();

    await user.click(screen.getByLabelText("Git branch"));
    await user.click(
      await screen.findByRole("button", { name: "Delete feature/test" }),
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    const mergeRequest = fetchMock.mock.calls[1] as [string, RequestInit];
    const deleteRequest = fetchMock.mock.calls[2] as [string, RequestInit];

    expect(confirmMock).toHaveBeenCalledWith(
      'Delete local branch "feature/test"?',
    );
    expect(mergeRequest[0]).toBe("/api/repository/branches/merge");
    expect(JSON.parse(String(mergeRequest[1].body))).toEqual({
      branch: "feature/test",
    });
    expect(deleteRequest[0]).toBe("/api/repository/branches");
    expect(deleteRequest[1].method).toBe("DELETE");
    expect(JSON.parse(String(deleteRequest[1].body))).toEqual({
      branch: "feature/test",
    });
  });

  it("shows branch load errors", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "Not a Git repository." }, { ok: false }),
    );

    renderTopBar({
      repositorySelection: {
        repositoryPath: "C:\\repo\\agent-goal-runner",
        status: "ready",
      },
    });

    expect(await screen.findByText("Not a Git repository.")).toBeTruthy();
  });

  it("disables branch controls while a run is active", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        branches: ["main"],
        currentBranch: "main",
        workingTreeStatus: "clean",
      }),
    );

    renderTopBar({
      repositorySelection: {
        repositoryPath: "C:\\repo\\agent-goal-runner",
        status: "ready",
      },
      status: "running",
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Git branch")).toHaveProperty(
        "disabled",
        true,
      );
    });
    expect(
      screen.getByRole("button", { name: "Refresh Git branches" }),
    ).toHaveProperty("disabled", true);
  });
});
