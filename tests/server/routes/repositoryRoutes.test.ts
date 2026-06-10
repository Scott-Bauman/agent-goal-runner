import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { FolderDialogUnsupportedError } from "../../../src/server/repository/folderDialog";
import type { ProcessSpawner } from "../../../src/server/shared/process";
import { chokidarMocks, getLatestWatchOptions } from "../helpers/chokidarMock";
import {
  closeTestServer,
  createTestServer,
  listenOnRandomPort,
} from "../helpers/fastify";
import { createMockRunProcess } from "../helpers/process";
import {
  browseRepository,
  queueRepositoryBrowseResult,
} from "../helpers/repositoryBrowse";
import { parseSsePayloads, readSseChunk } from "../helpers/sse";
import {
  createRepositoryPath,
  createTempPath,
} from "../helpers/tempRepository";
import { useServerTestLifecycle } from "../helpers/lifecycle";

useServerTestLifecycle();

type GitCommandResult = {
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
};

function createGitSpawner(results: GitCommandResult[]) {
  const queuedResults = [...results];
  const spawnProcess = vi.fn<ProcessSpawner>(() => {
    const childProcess = createMockRunProcess();
    const result = queuedResults.shift() ?? {};

    queueMicrotask(() => {
      if (result.stdout) {
        childProcess.stdout.write(result.stdout);
      }

      if (result.stderr) {
        childProcess.stderr.write(result.stderr);
      }

      childProcess.emit("close", result.exitCode ?? 0, null);
    });

    return childProcess;
  });

  return spawnProcess;
}

describe("repository selection endpoint", () => {
  it("returns no selected repository before selection", async () => {
    const app = await createTestServer();

    const response = await app.inject({
      method: "GET",
      url: "/api/repository/selection",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      repositoryPath: null,
    });
  });

  it("browses and stores an existing git repository directory", async () => {
    const repositoryPath = await createRepositoryPath();
    const app = await createTestServer();
    const origin = await listenOnRandomPort(app);
    const eventResponse = await globalThis.fetch(`${origin}/api/events`);
    const reader = eventResponse.body?.getReader();

    if (!reader) {
      throw new Error("Missing SSE response body.");
    }

    await readSseChunk(reader);

    const response = await browseRepository(app, repositoryPath);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      repositoryPath: path.normalize(repositoryPath),
      cancelled: false,
    });
    expect(chokidarMocks.watch).toHaveBeenCalledWith(
      path.join(path.normalize(repositoryPath), "goal.md"),
      expect.objectContaining({
        ignoreInitial: true,
        ignored: expect.any(Function),
      }),
    );

    const watchOptions = getLatestWatchOptions();
    const goalPath = path.join(path.normalize(repositoryPath), "goal.md");

    expect(watchOptions.ignored(goalPath, { isFile: () => true })).toBe(false);
    expect(
      watchOptions.ignored(path.join(path.normalize(repositoryPath), "README.md"), {
        isFile: () => true,
      }),
    ).toBe(true);
    expect(watchOptions.ignored(path.normalize(repositoryPath), { isFile: () => false })).toBe(
      false,
    );

    const updateChunk = await readSseChunk(reader);
    await reader.cancel();

    expect(parseSsePayloads(updateChunk, "status")).toEqual([
      {
        status: "idle",
        selectedRepositoryPath: path.normalize(repositoryPath),
      },
    ]);
  });

  it("stores the selected repository in server memory", async () => {
    const repositoryPath = await createRepositoryPath();
    const app = await createTestServer();

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "GET",
      url: "/api/repository/selection",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      repositoryPath: path.normalize(repositoryPath),
    });
  });

  it("requires a selected repository before listing branches", async () => {
    const app = await createTestServer();

    const response = await app.inject({
      method: "GET",
      url: "/api/repository/branches",
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "No repository selected.",
    });
  });

  it("lists local repository branches with the current branch", async () => {
    const repositoryPath = await createRepositoryPath();
    const spawnProcess = createGitSpawner([
      { stdout: "feature/top-bar\n" },
      { stdout: "main\nfeature/top-bar\n" },
      {},
    ]);
    const app = await createTestServer({ spawnProcess });

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "GET",
      url: "/api/repository/branches",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      currentBranch: "feature/top-bar",
      branches: ["feature/top-bar", "main"],
      workingTreeStatus: "clean",
    });
    expect(spawnProcess.mock.calls.map(([command, args, options]) => ({
      command,
      args,
      cwd: options.cwd,
    }))).toEqual([
      {
        command: "git",
        args: ["branch", "--show-current"],
        cwd: path.normalize(repositoryPath),
      },
      {
        command: "git",
        args: ["branch", "--format=%(refname:short)"],
        cwd: path.normalize(repositoryPath),
      },
      {
        command: "git",
        args: ["status", "--porcelain"],
        cwd: path.normalize(repositoryPath),
      },
    ]);
  });

  it("switches to an existing local branch and returns refreshed branch state", async () => {
    const repositoryPath = await createRepositoryPath();
    const spawnProcess = createGitSpawner([
      { stdout: "main\n" },
      { stdout: "main\nfeature/top-bar\n" },
      {},
      {},
      { stdout: "feature/top-bar\n" },
      { stdout: "main\nfeature/top-bar\n" },
      {},
    ]);
    const app = await createTestServer({ spawnProcess });

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "POST",
      url: "/api/repository/branches/switch",
      payload: {
        branch: "feature/top-bar",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      currentBranch: "feature/top-bar",
      branches: ["feature/top-bar", "main"],
      workingTreeStatus: "clean",
    });
    expect(spawnProcess.mock.calls.map(([, args]) => args)).toEqual([
      ["branch", "--show-current"],
      ["branch", "--format=%(refname:short)"],
      ["status", "--porcelain"],
      ["switch", "--", "feature/top-bar"],
      ["branch", "--show-current"],
      ["branch", "--format=%(refname:short)"],
      ["status", "--porcelain"],
    ]);
  });

  it("passes option-like branch names as switch operands", async () => {
    const repositoryPath = await createRepositoryPath();
    const spawnProcess = createGitSpawner([
      { stdout: "main\n" },
      { stdout: "main\n--detach\n" },
      {},
      {},
      { stdout: "--detach\n" },
      { stdout: "main\n--detach\n" },
      {},
    ]);
    const app = await createTestServer({ spawnProcess });

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "POST",
      url: "/api/repository/branches/switch",
      payload: {
        branch: "--detach",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(spawnProcess.mock.calls.map(([, args]) => args)).toContainEqual([
      "switch",
      "--",
      "--detach",
    ]);
  });

  it("creates a new branch from the current HEAD and returns refreshed branch state", async () => {
    const repositoryPath = await createRepositoryPath();
    const spawnProcess = createGitSpawner([
      {},
      {},
      { stdout: "feature/new-work\n" },
      { stdout: "main\nfeature/new-work\n" },
      {},
    ]);
    const app = await createTestServer({ spawnProcess });

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "POST",
      url: "/api/repository/branches",
      payload: {
        name: "feature/new-work",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      currentBranch: "feature/new-work",
      branches: ["feature/new-work", "main"],
      workingTreeStatus: "clean",
    });
    expect(spawnProcess.mock.calls.map(([, args]) => args)).toEqual([
      ["check-ref-format", "--branch", "feature/new-work"],
      ["switch", "-c", "feature/new-work"],
      ["branch", "--show-current"],
      ["branch", "--format=%(refname:short)"],
      ["status", "--porcelain"],
    ]);
  });

  it("reports changed working tree state while listing branches", async () => {
    const repositoryPath = await createRepositoryPath();
    const spawnProcess = createGitSpawner([
      { stdout: "main\n" },
      { stdout: "main\nfeature/top-bar\n" },
      { stdout: " M goal.md\n" },
    ]);
    const app = await createTestServer({ spawnProcess });

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "GET",
      url: "/api/repository/branches",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      currentBranch: "main",
      branches: ["feature/top-bar", "main"],
      workingTreeStatus: "changes",
    });
  });

  it("merges an existing local branch into the current branch", async () => {
    const repositoryPath = await createRepositoryPath();
    const spawnProcess = createGitSpawner([
      { stdout: "main\n" },
      { stdout: "main\nfeature/top-bar\n" },
      {},
      {},
      { stdout: "main\n" },
      { stdout: "main\nfeature/top-bar\n" },
      { stdout: " M goal.md\n" },
    ]);
    const app = await createTestServer({ spawnProcess });

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "POST",
      url: "/api/repository/branches/merge",
      payload: {
        branch: "feature/top-bar",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      currentBranch: "main",
      branches: ["feature/top-bar", "main"],
      workingTreeStatus: "changes",
    });
    expect(spawnProcess.mock.calls.map(([, args]) => args)).toEqual([
      ["branch", "--show-current"],
      ["branch", "--format=%(refname:short)"],
      ["status", "--porcelain"],
      ["merge", "--no-edit", "--", "feature/top-bar"],
      ["branch", "--show-current"],
      ["branch", "--format=%(refname:short)"],
      ["status", "--porcelain"],
    ]);
  });

  it("rejects branch merges without a selected repository", async () => {
    const app = await createTestServer();

    const response = await app.inject({
      method: "POST",
      url: "/api/repository/branches/merge",
      payload: {
        branch: "feature/top-bar",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "No repository selected.",
    });
  });

  it("rejects branch merges while a run is active", async () => {
    const repositoryPath = await createRepositoryPath();
    const runProcess = createMockRunProcess();
    const spawnProcess = vi.fn(() => runProcess);
    const app = await createTestServer({ spawnProcess });

    await browseRepository(app, repositoryPath);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/repository/branches/merge",
      payload: {
        branch: "feature/top-bar",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "Cannot merge branches while a run is active.",
    });
    expect(spawnProcess).toHaveBeenCalledTimes(1);
  });

  it("rejects branch merge requests with a missing branch", async () => {
    const repositoryPath = await createRepositoryPath();
    const app = await createTestServer();

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "POST",
      url: "/api/repository/branches/merge",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "VALIDATION_ERROR",
      error: "Invalid branch merge request.",
      issues: [
        {
          path: "branch",
          message: "Branch is required.",
        },
      ],
    });
  });

  it("rejects branch merges of the current branch", async () => {
    const repositoryPath = await createRepositoryPath();
    const spawnProcess = createGitSpawner([
      { stdout: "main\n" },
      { stdout: "main\nfeature/top-bar\n" },
      {},
    ]);
    const app = await createTestServer({ spawnProcess });

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "POST",
      url: "/api/repository/branches/merge",
      payload: {
        branch: "main",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "VALIDATION_ERROR",
      error: "Invalid branch merge request.",
      issues: [
        {
          path: "branch",
          message: "Branch must not be the current branch.",
        },
      ],
    });
  });

  it("rejects branch merges of unknown local branches", async () => {
    const repositoryPath = await createRepositoryPath();
    const spawnProcess = createGitSpawner([
      { stdout: "main\n" },
      { stdout: "main\nfeature/top-bar\n" },
      {},
    ]);
    const app = await createTestServer({ spawnProcess });

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "POST",
      url: "/api/repository/branches/merge",
      payload: {
        branch: "missing",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "VALIDATION_ERROR",
      error: "Invalid branch merge request.",
      issues: [
        {
          path: "branch",
          message: "Branch must be an existing local branch.",
        },
      ],
    });
  });

  it("deletes an existing local branch with safe delete", async () => {
    const repositoryPath = await createRepositoryPath();
    const spawnProcess = createGitSpawner([
      { stdout: "main\n" },
      { stdout: "main\nfeature/top-bar\n" },
      {},
      {},
      { stdout: "main\n" },
      { stdout: "main\n" },
      {},
    ]);
    const app = await createTestServer({ spawnProcess });

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "DELETE",
      url: "/api/repository/branches",
      payload: {
        branch: "feature/top-bar",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      currentBranch: "main",
      branches: ["main"],
      workingTreeStatus: "clean",
    });
    expect(spawnProcess.mock.calls.map(([, args]) => args)).toEqual([
      ["branch", "--show-current"],
      ["branch", "--format=%(refname:short)"],
      ["status", "--porcelain"],
      ["branch", "-d", "--", "feature/top-bar"],
      ["branch", "--show-current"],
      ["branch", "--format=%(refname:short)"],
      ["status", "--porcelain"],
    ]);
  });

  it("rejects branch deletions of the current branch", async () => {
    const repositoryPath = await createRepositoryPath();
    const spawnProcess = createGitSpawner([
      { stdout: "main\n" },
      { stdout: "main\nfeature/top-bar\n" },
      {},
    ]);
    const app = await createTestServer({ spawnProcess });

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "DELETE",
      url: "/api/repository/branches",
      payload: {
        branch: "main",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "VALIDATION_ERROR",
      error: "Invalid branch deletion request.",
      issues: [
        {
          path: "branch",
          message: "Branch must not be the current branch.",
        },
      ],
    });
  });

  it("rejects branch deletions while a run is active", async () => {
    const repositoryPath = await createRepositoryPath();
    const runProcess = createMockRunProcess();
    const spawnProcess = vi.fn(() => runProcess);
    const app = await createTestServer({ spawnProcess });

    await browseRepository(app, repositoryPath);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
      },
    });

    const response = await app.inject({
      method: "DELETE",
      url: "/api/repository/branches",
      payload: {
        branch: "feature/top-bar",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "Cannot delete branches while a run is active.",
    });
    expect(spawnProcess).toHaveBeenCalledTimes(1);
  });

  it("rejects branch deletions of unknown local branches", async () => {
    const repositoryPath = await createRepositoryPath();
    const spawnProcess = createGitSpawner([
      { stdout: "main\n" },
      { stdout: "main\nfeature/top-bar\n" },
      {},
    ]);
    const app = await createTestServer({ spawnProcess });

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "DELETE",
      url: "/api/repository/branches",
      payload: {
        branch: "missing",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "VALIDATION_ERROR",
      error: "Invalid branch deletion request.",
      issues: [
        {
          path: "branch",
          message: "Branch must be an existing local branch.",
        },
      ],
    });
  });

  it("surfaces safe-delete failures from git", async () => {
    const repositoryPath = await createRepositoryPath();
    const spawnProcess = createGitSpawner([
      { stdout: "main\n" },
      { stdout: "main\nfeature/top-bar\n" },
      {},
      {
        stderr: "error: The branch 'feature/top-bar' is not fully merged.\n",
        exitCode: 1,
      },
    ]);
    const app = await createTestServer({ spawnProcess });

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "DELETE",
      url: "/api/repository/branches",
      payload: {
        branch: "feature/top-bar",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "error: The branch 'feature/top-bar' is not fully merged.",
    });
  });

  it("returns branch name validation errors from git", async () => {
    const repositoryPath = await createRepositoryPath();
    const spawnProcess = createGitSpawner([
      {
        stderr: "fatal: 'bad name' is not a valid branch name\n",
        exitCode: 128,
      },
    ]);
    const app = await createTestServer({ spawnProcess });

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "POST",
      url: "/api/repository/branches",
      payload: {
        name: "bad name",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: "VALIDATION_ERROR",
      error: "Invalid branch creation request.",
      issues: [
        {
          path: "name",
          message: "fatal: 'bad name' is not a valid branch name",
        },
      ],
    });
  });

  it("surfaces git failures while listing branches", async () => {
    const repositoryPath = await createRepositoryPath();
    const spawnProcess = createGitSpawner([
      {
        stderr: "fatal: not a git repository\n",
        exitCode: 128,
      },
      {
        stderr: "fatal: not a git repository\n",
        exitCode: 128,
      },
    ]);
    const app = await createTestServer({ spawnProcess });

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "GET",
      url: "/api/repository/branches",
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: "fatal: not a git repository",
    });
  });

  it("does not replace the selected repository after cancellation", async () => {
    const repositoryPath = await createRepositoryPath();
    const app = await createTestServer();

    await browseRepository(app, repositoryPath);
    queueRepositoryBrowseResult({
      cancelled: true,
      path: null,
    });

    const cancelResponse = await app.inject({
      method: "POST",
      url: "/api/repository/browse",
    });

    expect(cancelResponse.statusCode).toBe(200);
    expect(cancelResponse.json()).toEqual({
      repositoryPath: null,
      cancelled: true,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/repository/selection",
    });

    expect(response.json()).toEqual({
      repositoryPath: path.normalize(repositoryPath),
    });
    expect(chokidarMocks.watch).toHaveBeenCalledTimes(1);
  });

  it("does not replace the selected repository after invalid folder selection", async () => {
    const repositoryPath = await createRepositoryPath();
    const invalidRepositoryPath = await createTempPath();
    const app = await createTestServer();

    await browseRepository(app, repositoryPath);
    const invalidResponse = await browseRepository(app, invalidRepositoryPath);

    expect(invalidResponse.statusCode).toBe(400);
    expect(invalidResponse.json()).toMatchObject({
      error: "Invalid repository selection request.",
      code: "VALIDATION_ERROR",
      issues: [
        {
          path: "path",
          message: "Path must be a git repository.",
        },
      ],
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/repository/selection",
    });

    expect(response.json()).toEqual({
      repositoryPath: path.normalize(repositoryPath),
    });
    expect(chokidarMocks.watch).toHaveBeenCalledTimes(1);
  });

  it("returns a clear error when the folder picker is unsupported", async () => {
    const repositoryPath = await createRepositoryPath();
    const openRepositoryFolderDialog = vi
      .fn()
      .mockResolvedValueOnce({
        cancelled: false,
        path: repositoryPath,
      })
      .mockRejectedValueOnce(
        new FolderDialogUnsupportedError(
          "Unable to open a folder picker on this Linux system. Install zenity or kdialog and try again.",
        ),
      );
    const app = await createTestServer({
      openRepositoryFolderDialog,
    });

    await app.inject({
      method: "POST",
      url: "/api/repository/browse",
    });

    const unsupportedResponse = await app.inject({
      method: "POST",
      url: "/api/repository/browse",
    });

    expect(unsupportedResponse.statusCode).toBe(500);
    expect(unsupportedResponse.json()).toEqual({
      error:
        "Unable to open a folder picker on this Linux system. Install zenity or kdialog and try again.",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/repository/selection",
    });

    expect(response.json()).toEqual({
      repositoryPath: path.normalize(repositoryPath),
    });
    expect(chokidarMocks.watch).toHaveBeenCalledTimes(1);
  });

  it("does not register the old typed path selection endpoint", async () => {
    const repositoryPath = await createRepositoryPath();
    const app = await createTestServer();

    const response = await app.inject({
      method: "POST",
      url: "/api/repository/select",
      payload: {
        path: repositoryPath,
      },
    });

    expect(response.statusCode).toBe(404);
    expect(chokidarMocks.watch).not.toHaveBeenCalled();
  });

  it("replaces the goal watcher when a different repository is selected", async () => {
    const firstRepositoryPath = await createRepositoryPath();
    const secondRepositoryPath = await createRepositoryPath();
    const app = await createTestServer();

    await browseRepository(app, firstRepositoryPath);
    const response = await browseRepository(app, secondRepositoryPath);

    expect(response.statusCode).toBe(200);
    expect(chokidarMocks.close).toHaveBeenCalledTimes(1);
    expect(chokidarMocks.watch).toHaveBeenCalledTimes(2);
    expect(chokidarMocks.watch).toHaveBeenLastCalledWith(
      path.join(path.normalize(secondRepositoryPath), "goal.md"),
      expect.objectContaining({
        ignoreInitial: true,
        ignored: expect.any(Function),
      }),
    );
  });

  it("closes the goal watcher when the server closes", async () => {
    const repositoryPath = await createRepositoryPath();
    const app = await createTestServer();

    await browseRepository(app, repositoryPath);
    await closeTestServer();

    expect(chokidarMocks.close).toHaveBeenCalledTimes(1);
  });

  it("does not persist selected repository across server instances", async () => {
    const repositoryPath = await createRepositoryPath();
    const firstApp = await createTestServer();

    await browseRepository(firstApp, repositoryPath);
    await firstApp.close();

    const secondApp = await createTestServer();
    const response = await secondApp.inject({
      method: "GET",
      url: "/api/repository/selection",
    });

    expect(response.json()).toEqual({
      repositoryPath: null,
    });
  });

  it("accepts a git worktree marker file", async () => {
    const repositoryPath = await createTempPath();
    await writeFile(
      path.join(repositoryPath, ".git"),
      "gitdir: ../.git/worktrees/example\n",
    );
    const app = await createTestServer();

    const response = await browseRepository(app, repositoryPath);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      repositoryPath: path.normalize(repositoryPath),
      cancelled: false,
    });
  });

  it("rejects a file path", async () => {
    const repositoryPath = await createTempPath();
    const filePath = path.join(repositoryPath, "file.txt");
    await writeFile(filePath, "not a repository\n");
    const app = await createTestServer();

    const response = await browseRepository(app, filePath);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "Invalid repository selection request.",
      code: "VALIDATION_ERROR",
      issues: [
        {
          path: "path",
          message: "Path must be an existing directory.",
        },
      ],
    });
  });
});
