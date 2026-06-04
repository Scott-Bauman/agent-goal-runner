import type { FastifyInstance } from "fastify";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { TextDecoder } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildServer } from "../../src/server/index";

const chokidarMocks = vi.hoisted(() => {
  const close = vi.fn(() => Promise.resolve());

  return {
    close,
    watch: vi.fn(() => ({
      close,
    })),
  };
});

vi.mock("chokidar", () => ({
  watch: chokidarMocks.watch,
}));

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

async function listenOnRandomPort(app: FastifyInstance): Promise<string> {
  await app.listen({
    host: "127.0.0.1",
    port: 0,
  });

  const address = app.server.address();

  if (!address || typeof address === "string") {
    throw new Error("Fastify did not expose a TCP address.");
  }

  return `http://127.0.0.1:${(address as AddressInfo).port}`;
}

function parseSsePayloads(text: string, eventName: string): unknown[] {
  return text
    .trim()
    .split("\n\n")
    .filter((block) => block.startsWith(`event: ${eventName}\n`))
    .map((block) => {
      const dataLine = block.split("\n").find((line) => line.startsWith("data: "));

      if (!dataLine) {
        throw new Error(`Missing data line for SSE event ${eventName}.`);
      }

      return JSON.parse(dataLine.slice("data: ".length)) as unknown;
    });
}

async function readSseChunk(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const result = await reader.read();

  if (result.done) {
    throw new Error("SSE stream ended before sending an event.");
  }

  return new TextDecoder().decode(result.value);
}

beforeEach(() => {
  chokidarMocks.close.mockClear();
  chokidarMocks.watch.mockClear();
});

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
    expect(chokidarMocks.watch).toHaveBeenCalledWith(
      path.join(path.normalize(repositoryPath), "goal.md"),
      {
        ignoreInitial: true,
      },
    );
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
    expect(chokidarMocks.watch).toHaveBeenCalledTimes(1);
  });

  it("replaces the goal watcher when a different repository is selected", async () => {
    const firstRepositoryPath = await createRepositoryPath();
    const secondRepositoryPath = await createRepositoryPath();
    const app = await getServer();

    await app.inject({
      method: "POST",
      url: "/api/repository/select",
      payload: {
        path: firstRepositoryPath,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/repository/select",
      payload: {
        path: secondRepositoryPath,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(chokidarMocks.close).toHaveBeenCalledTimes(1);
    expect(chokidarMocks.watch).toHaveBeenCalledTimes(2);
    expect(chokidarMocks.watch).toHaveBeenLastCalledWith(
      path.join(path.normalize(secondRepositoryPath), "goal.md"),
      {
        ignoreInitial: true,
      },
    );
  });

  it("closes the goal watcher when the server closes", async () => {
    const repositoryPath = await createRepositoryPath();
    const app = await getServer();

    await app.inject({
      method: "POST",
      url: "/api/repository/select",
      payload: {
        path: repositoryPath,
      },
    });
    await app.close();
    server = undefined;

    expect(chokidarMocks.close).toHaveBeenCalledTimes(1);
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
    ["missing path", {}, "path", "Required"],
    ["empty path", { path: "   " }, "path", "Path is required."],
    [
      "relative path",
      { path: "relative/repo" },
      "path",
      "Path must be an absolute local filesystem path.",
    ],
    [
      "URL path",
      { path: "https://example.com/repo.git" },
      "path",
      "Path must be an absolute local filesystem path.",
    ],
    [
      "extra fields",
      { path: path.resolve("example-repo"), name: "repo" },
      "request",
      "Unrecognized key(s) in object: 'name'",
    ],
  ])(
    "rejects an invalid payload with frontend-ready issues: %s",
    async (_name, payload, issuePath, issueMessage) => {
    const app = await getServer();

    const response = await app.inject({
      method: "POST",
      url: "/api/repository/select",
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "Invalid repository selection request.",
      code: "VALIDATION_ERROR",
    });
    expect(response.json().issues).toEqual(
      expect.arrayContaining([
        {
          path: issuePath,
          message: issueMessage,
        },
      ]),
    );
    },
  );

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
      code: "VALIDATION_ERROR",
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
      code: "VALIDATION_ERROR",
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
      code: "VALIDATION_ERROR",
      issues: [
        {
          path: "path",
          message: "Path must be a git repository.",
        },
      ],
    });
  });
});

describe("events endpoint", () => {
  it("streams the initial status, logs, progress, and summary snapshot", async () => {
    const app = await getServer();
    const origin = await listenOnRandomPort(app);

    const response = await globalThis.fetch(`${origin}/api/events`);
    const reader = response.body?.getReader();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(reader).toBeDefined();

    if (!reader) {
      throw new Error("Missing SSE response body.");
    }

    const chunk = await readSseChunk(reader);
    await reader.cancel();

    expect(parseSsePayloads(chunk, "status")).toEqual([
      {
        status: "idle",
        selectedRepositoryPath: null,
      },
    ]);
    expect(parseSsePayloads(chunk, "logs")).toEqual([
      {
        entries: [],
      },
    ]);
    expect(parseSsePayloads(chunk, "progress")).toEqual([
      {
        currentRun: 0,
        totalRuns: null,
      },
    ]);
    expect(parseSsePayloads(chunk, "summary")).toEqual([null]);
  });

  it("rejects caller-provided events query parameters", async () => {
    const app = await getServer();

    const response = await app.inject({
      method: "GET",
      url: "/api/events?name=refactor.md",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Invalid events request.",
      code: "VALIDATION_ERROR",
      issues: [
        {
          path: "request",
          message: "Unrecognized key(s) in object: 'name'",
        },
      ],
    });
  });

  it("broadcasts status updates when the selected repository changes", async () => {
    const repositoryPath = await createRepositoryPath();
    const app = await getServer();
    const origin = await listenOnRandomPort(app);

    const response = await globalThis.fetch(`${origin}/api/events`);
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error("Missing SSE response body.");
    }

    await readSseChunk(reader);

    await app.inject({
      method: "POST",
      url: "/api/repository/select",
      payload: {
        path: repositoryPath,
      },
    });

    const updateChunk = await readSseChunk(reader);
    await reader.cancel();

    expect(parseSsePayloads(updateChunk, "status")).toEqual([
      {
        status: "idle",
        selectedRepositoryPath: path.normalize(repositoryPath),
      },
    ]);
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
    expect(response.json()).toEqual({
      error: "Invalid goal request.",
      code: "VALIDATION_ERROR",
      issues: [
        {
          path: "request",
          message: "Unrecognized key(s) in object: 'path'",
        },
      ],
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
    expect(response.json()).toEqual({
      error: "Invalid goal request.",
      code: "VALIDATION_ERROR",
      issues: [
        {
          path: "request",
          message: "Unrecognized key(s) in object: 'name'",
        },
      ],
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
    expect(pathResponse.json()).toEqual({
      error: "Invalid goal creation request.",
      code: "VALIDATION_ERROR",
      issues: [
        {
          path: "request",
          message: "Unrecognized key(s) in object: 'path'",
        },
      ],
    });
    expect(nameResponse.statusCode).toBe(400);
    expect(nameResponse.json()).toEqual({
      error: "Invalid goal creation request.",
      code: "VALIDATION_ERROR",
      issues: [
        {
          path: "request",
          message: "Unrecognized key(s) in object: 'name'",
        },
      ],
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
