import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { FolderDialogUnsupportedError } from "../../../src/server/repository/folderDialog";
import { chokidarMocks, getLatestWatchOptions } from "../helpers/chokidarMock";
import {
  closeTestServer,
  createTestServer,
  listenOnRandomPort,
} from "../helpers/fastify";
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
