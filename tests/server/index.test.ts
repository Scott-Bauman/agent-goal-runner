import type { FastifyInstance } from "fastify";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildServer } from "../../src/server/index";

let server: FastifyInstance | undefined;
const tempPaths: string[] = [];

async function getServer(): Promise<FastifyInstance> {
  server = await buildServer();
  return server;
}

async function createTempPath(): Promise<string> {
  const tempPath = await mkdtemp(path.join(os.tmpdir(), "codex-goal-runner-"));
  tempPaths.push(tempPath);
  return tempPath;
}

async function createRepositoryPath(): Promise<string> {
  const repositoryPath = await createTempPath();
  await mkdir(path.join(repositoryPath, ".git"));
  return repositoryPath;
}

afterEach(async () => {
  await server?.close();
  server = undefined;

  await Promise.all(
    tempPaths.splice(0).map((tempPath) =>
      rm(tempPath, {
        force: true,
        recursive: true,
      }),
    ),
  );
});

describe("repository selection endpoint", () => {
  it("returns no selected repository before selection", async () => {
    const app = await getServer();

    const response = await app.inject({
      method: "GET",
      url: "/api/repository/selection",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      repositoryPath: null,
    });
  });

  it("accepts an existing git repository directory", async () => {
    const repositoryPath = await createRepositoryPath();
    const app = await getServer();

    const response = await app.inject({
      method: "POST",
      url: "/api/repository/select",
      payload: {
        path: repositoryPath,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      repositoryPath: path.normalize(repositoryPath),
    });
  });

  it("stores the selected repository in server memory", async () => {
    const repositoryPath = await createRepositoryPath();
    const app = await getServer();

    await app.inject({
      method: "POST",
      url: "/api/repository/select",
      payload: {
        path: repositoryPath,
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/repository/selection",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      repositoryPath: path.normalize(repositoryPath),
    });
  });

  it("does not replace the selected repository after invalid selection", async () => {
    const repositoryPath = await createRepositoryPath();
    const app = await getServer();

    await app.inject({
      method: "POST",
      url: "/api/repository/select",
      payload: {
        path: repositoryPath,
      },
    });

    const invalidResponse = await app.inject({
      method: "POST",
      url: "/api/repository/select",
      payload: {
        path: path.join(os.tmpdir(), "codex-goal-runner-missing-repo"),
      },
    });

    expect(invalidResponse.statusCode).toBe(400);

    const response = await app.inject({
      method: "GET",
      url: "/api/repository/selection",
    });

    expect(response.json()).toEqual({
      repositoryPath: path.normalize(repositoryPath),
    });
  });

  it("does not persist selected repository across server instances", async () => {
    const repositoryPath = await createRepositoryPath();
    const firstApp = await getServer();

    await firstApp.inject({
      method: "POST",
      url: "/api/repository/select",
      payload: {
        path: repositoryPath,
      },
    });
    await firstApp.close();

    const secondApp = await getServer();
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
    const app = await getServer();

    const response = await app.inject({
      method: "POST",
      url: "/api/repository/select",
      payload: {
        path: repositoryPath,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      repositoryPath: path.normalize(repositoryPath),
    });
  });

  it.each([
    ["missing path", {}],
    ["empty path", { path: "   " }],
    ["relative path", { path: "relative/repo" }],
    ["URL path", { path: "https://example.com/repo.git" }],
    ["extra fields", { path: path.resolve("example-repo"), name: "repo" }],
  ])("rejects an invalid payload: %s", async (_name, payload) => {
    const app = await getServer();

    const response = await app.inject({
      method: "POST",
      url: "/api/repository/select",
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "Invalid repository selection request.",
    });
  });

  it("rejects a missing absolute path", async () => {
    const app = await getServer();

    const response = await app.inject({
      method: "POST",
      url: "/api/repository/select",
      payload: {
        path: path.join(os.tmpdir(), "codex-goal-runner-missing-repo"),
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "Invalid repository selection request.",
      issues: [
        {
          path: "path",
          message: "Path must exist.",
        },
      ],
    });
  });

  it("rejects a file path", async () => {
    const repositoryPath = await createTempPath();
    const filePath = path.join(repositoryPath, "file.txt");
    await writeFile(filePath, "not a repository\n");
    const app = await getServer();

    const response = await app.inject({
      method: "POST",
      url: "/api/repository/select",
      payload: {
        path: filePath,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "Invalid repository selection request.",
      issues: [
        {
          path: "path",
          message: "Path must be an existing directory.",
        },
      ],
    });
  });

  it("rejects a directory without a git marker", async () => {
    const repositoryPath = await createTempPath();
    const app = await getServer();

    const response = await app.inject({
      method: "POST",
      url: "/api/repository/select",
      payload: {
        path: repositoryPath,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "Invalid repository selection request.",
      issues: [
        {
          path: "path",
          message: "Path must be a git repository.",
        },
      ],
    });
  });
});

describe("goal read endpoint", () => {
  it("requires a selected repository", async () => {
    const app = await getServer();

    const response = await app.inject({
      method: "GET",
      url: "/api/goal",
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "No repository selected.",
    });
  });

  it("reads the selected repository goal.md", async () => {
    const repositoryPath = await createRepositoryPath();
    await writeFile(path.join(repositoryPath, "goal.md"), "# Selected Goal\n");
    const app = await getServer();

    await app.inject({
      method: "POST",
      url: "/api/repository/select",
      payload: {
        path: repositoryPath,
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/goal",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      repositoryPath: path.normalize(repositoryPath),
      goalPath: path.join(path.normalize(repositoryPath), "goal.md"),
      markdown: "# Selected Goal\n",
    });
  });

  it("returns a clear missing-goal state when goal.md does not exist", async () => {
    const repositoryPath = await createRepositoryPath();
    const app = await getServer();

    await app.inject({
      method: "POST",
      url: "/api/repository/select",
      payload: {
        path: repositoryPath,
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/goal",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: "goal.md does not exist in the selected repository.",
      code: "GOAL_MISSING",
      repositoryPath: path.normalize(repositoryPath),
      goalPath: path.join(path.normalize(repositoryPath), "goal.md"),
      exists: false,
    });
  });

  it("rejects caller-provided path query parameters", async () => {
    const repositoryPath = await createRepositoryPath();
    const otherPath = await createRepositoryPath();
    await writeFile(path.join(repositoryPath, "goal.md"), "# Selected Goal\n");
    await writeFile(path.join(otherPath, "goal.md"), "# Other Goal\n");
    const app = await getServer();

    await app.inject({
      method: "POST",
      url: "/api/repository/select",
      payload: {
        path: repositoryPath,
      },
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/goal?path=${encodeURIComponent(path.join(otherPath, "goal.md"))}`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "Invalid goal request.",
    });
  });

  it("rejects alternate plan names", async () => {
    const repositoryPath = await createRepositoryPath();
    await writeFile(path.join(repositoryPath, "goal.md"), "# Selected Goal\n");
    await writeFile(path.join(repositoryPath, "refactor.md"), "# Refactor Plan\n");
    const app = await getServer();

    await app.inject({
      method: "POST",
      url: "/api/repository/select",
      payload: {
        path: repositoryPath,
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/goal?name=refactor.md",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "Invalid goal request.",
    });
  });
});

describe("goal creation endpoint", () => {
  it("requires a selected repository", async () => {
    const app = await getServer();

    const response = await app.inject({
      method: "POST",
      url: "/api/goal",
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "No repository selected.",
    });
  });

  it("creates a default goal.md in the selected repository", async () => {
    const repositoryPath = await createRepositoryPath();
    const goalPath = path.join(path.normalize(repositoryPath), "goal.md");
    const app = await getServer();

    await app.inject({
      method: "POST",
      url: "/api/repository/select",
      payload: {
        path: repositoryPath,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/goal",
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      repositoryPath: path.normalize(repositoryPath),
      goalPath,
      exists: true,
    });
    expect(response.json().markdown).toContain("# Project Goal");
    expect(await readFile(goalPath, "utf8")).toBe(response.json().markdown);
  });

  it("rejects caller-provided creation paths and alternate names", async () => {
    const repositoryPath = await createRepositoryPath();
    const app = await getServer();

    await app.inject({
      method: "POST",
      url: "/api/repository/select",
      payload: {
        path: repositoryPath,
      },
    });

    const pathResponse = await app.inject({
      method: "POST",
      url: "/api/goal",
      payload: {
        path: path.join(repositoryPath, "refactor.md"),
      },
    });

    const nameResponse = await app.inject({
      method: "POST",
      url: "/api/goal?name=refactor.md",
    });

    expect(pathResponse.statusCode).toBe(400);
    expect(pathResponse.json()).toMatchObject({
      error: "Invalid goal creation request.",
    });
    expect(nameResponse.statusCode).toBe(400);
    expect(nameResponse.json()).toMatchObject({
      error: "Invalid goal creation request.",
    });
    await expect(readFile(path.join(repositoryPath, "goal.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("does not overwrite an existing goal.md", async () => {
    const repositoryPath = await createRepositoryPath();
    const goalPath = path.join(path.normalize(repositoryPath), "goal.md");
    await writeFile(goalPath, "# Existing Goal\n");
    const app = await getServer();

    await app.inject({
      method: "POST",
      url: "/api/repository/select",
      payload: {
        path: repositoryPath,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/goal",
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "goal.md already exists in the selected repository.",
      code: "GOAL_EXISTS",
      repositoryPath: path.normalize(repositoryPath),
      goalPath,
      exists: true,
    });
    expect(await readFile(goalPath, "utf8")).toBe("# Existing Goal\n");
  });
});
