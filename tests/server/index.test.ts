import type { FastifyInstance } from "fastify";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { TextDecoder } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RUNNER_STATUSES,
  buildServer,
  detectGoalStopMarker,
} from "../../src/server/index";

const chokidarMocks = vi.hoisted(() => {
  const close = vi.fn(() => Promise.resolve());
  const watcherInstances: Array<{
    handlers: Map<string, Array<(changedPath: string) => void>>;
  }> = [];

  return {
    close,
    watcherInstances,
    watch: vi.fn(() => {
      const handlers = new Map<string, Array<(changedPath: string) => void>>();
      const watcher = {
        close,
        on: vi.fn((eventName: string, handler: (changedPath: string) => void) => {
          handlers.set(eventName, [...(handlers.get(eventName) ?? []), handler]);
          return watcher;
        }),
      };

      watcherInstances.push({
        handlers,
      });

      return watcher;
    }),
  };
});

vi.mock("chokidar", () => ({
  watch: chokidarMocks.watch,
}));

let server: FastifyInstance | undefined;
const tempPaths: string[] = [];

function createMockRunProcess(pid = 321): ChildProcessWithoutNullStreams {
  return Object.assign(new EventEmitter(), {
    pid,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
  }) as unknown as ChildProcessWithoutNullStreams;
}

async function getServer(): Promise<FastifyInstance> {
  server = await buildServer({
    spawnProcess: vi.fn(() => createMockRunProcess()),
  });
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

async function readUntilSsePayloads(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  eventName: string,
): Promise<unknown[]> {
  let text = "";

  for (let attempt = 0; attempt < 10; attempt += 1) {
    text += await readSseChunk(reader);

    const payloads = parseSsePayloads(text, eventName);

    if (payloads.length > 0) {
      return payloads;
    }
  }

  throw new Error(`SSE stream did not send an event named ${eventName}.`);
}

function emitLatestGoalWatcherEvent(eventName: string, changedPath: string): void {
  const latestWatcher = chokidarMocks.watcherInstances.at(-1);

  if (!latestWatcher) {
    throw new Error("No goal watcher has been created.");
  }

  for (const handler of latestWatcher.handlers.get(eventName) ?? []) {
    handler(changedPath);
  }
}

function getLatestWatchOptions(): {
  ignored: (watchedPath: string, stats?: { isFile: () => boolean }) => boolean;
  ignoreInitial: boolean;
} {
  const latestWatchCall = chokidarMocks.watch.mock.calls.at(-1);

  if (!latestWatchCall) {
    throw new Error("No goal watcher has been created.");
  }

  return latestWatchCall[1] as {
    ignored: (watchedPath: string, stats?: { isFile: () => boolean }) => boolean;
    ignoreInitial: boolean;
  };
}

beforeEach(() => {
  chokidarMocks.close.mockClear();
  chokidarMocks.watch.mockClear();
  chokidarMocks.watcherInstances.splice(0);
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

describe("goal stop marker detection", () => {
  it("detects a complete marker", () => {
    expect(detectGoalStopMarker("# Goal\n\nGOAL_COMPLETE\n")).toBe("GOAL_COMPLETE");
  });

  it("detects a blocked marker", () => {
    expect(detectGoalStopMarker("GOAL_BLOCKED: waiting for input")).toBe(
      "GOAL_BLOCKED",
    );
  });

  it("returns null when no stop marker is present", () => {
    expect(detectGoalStopMarker("- [ ] Keep going\n")).toBeNull();
  });

  it("treats blocked as the higher-priority marker when both are present", () => {
    expect(detectGoalStopMarker("GOAL_COMPLETE\n\nGOAL_BLOCKED")).toBe(
      "GOAL_BLOCKED",
    );
  });
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
      expect.objectContaining({
        ignoreInitial: true,
        ignored: expect.any(Function),
      }),
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
    ["missing request body", undefined, "request", "Required"],
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
  it("defines the Phase 4 run-loop statuses", () => {
    expect(RUNNER_STATUSES).toEqual([
      "idle",
      "running",
      "stopping",
      "complete",
      "blocked",
      "failed",
      "stopped",
    ]);
  });

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

  it.each<[string, boolean]>([
    ["add", true],
    ["change", true],
    ["unlink", false],
  ])(
    "broadcasts goalChanged updates when the watched goal.md emits %s",
    async (watcherEvent, exists) => {
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
      await readSseChunk(reader);

      emitLatestGoalWatcherEvent(
        watcherEvent,
        path.join(path.normalize(repositoryPath), "goal.md"),
      );

      const updateChunk = await readSseChunk(reader);
      await reader.cancel();

      expect(parseSsePayloads(updateChunk, "goalChanged")).toEqual([
        {
          repositoryPath: path.normalize(repositoryPath),
          goalPath: path.join(path.normalize(repositoryPath), "goal.md"),
          exists,
        },
      ]);
    },
  );

  it("does not broadcast goalChanged updates for unrelated watched paths", async () => {
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
    await readSseChunk(reader);

    emitLatestGoalWatcherEvent(
      "change",
      path.join(path.normalize(repositoryPath), "README.md"),
    );

    const timeout = new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), 25);
    });
    const unexpectedChunk = await Promise.race([reader.read(), timeout]);
    await reader.cancel();

    expect(unexpectedChunk).toBe("timeout");
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

describe("run start endpoint", () => {
  it("requires a selected repository", async () => {
    const app = await getServer();

    const response = await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "No repository selected.",
    });
  });

  it.each([
    ["missing request body", undefined, "request", "Required"],
    ["missing prompt", { runCount: 1 }, "prompt", "Required"],
    ["empty prompt", { prompt: "   ", runCount: 1 }, "prompt", "Prompt is required."],
    [
      "missing run count",
      { prompt: "Use goal.md as the source of truth." },
      "runCount",
      "Run count is required.",
    ],
    [
      "fractional run count",
      { prompt: "Use goal.md as the source of truth.", runCount: 1.5 },
      "runCount",
      "Run count must be a whole number.",
    ],
    [
      "zero run count",
      { prompt: "Use goal.md as the source of truth.", runCount: 0 },
      "runCount",
      "Run count must be at least 1.",
    ],
    [
      "run count above maximum",
      { prompt: "Use goal.md as the source of truth.", runCount: 101 },
      "runCount",
      "Run count must be at most 100.",
    ],
    [
      "non-string verification command",
      {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        verificationCommand: ["npm", "test"],
      },
      "verificationCommand",
      "Verification command must be a string.",
    ],
    [
      "non-boolean auto-commit toggle",
      {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        autoCommit: "yes",
      },
      "autoCommit",
      "Auto-commit toggle must be a boolean.",
    ],
    [
      "verification command with shell operator",
      {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        verificationCommand: "npm test && npm run build",
      },
      "verificationCommand",
      "Verification command must use a single executable plus arguments; shell operators are not supported.",
    ],
    [
      "verification command with unterminated quote",
      {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        verificationCommand: 'npm test -- --testNamePattern "run loop',
      },
      "verificationCommand",
      "Verification command contains an unterminated quoted argument.",
    ],
    [
      "verification command through a shell",
      {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        verificationCommand: "powershell -Command npm test",
      },
      "verificationCommand",
      "Verification command must be a direct executable, not a shell.",
    ],
    [
      "extra fields",
      {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        planFile: "refactor.md",
      },
      "request",
      "Unrecognized key(s) in object: 'planFile'",
    ],
  ])(
    "rejects an invalid payload with frontend-ready issues: %s",
    async (_name, payload, issuePath, issueMessage) => {
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
        method: "POST",
        url: "/api/run/start",
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: "Invalid run start request.",
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

  it("rejects an invalid verification command before spawning a run", async () => {
    const repositoryPath = await createRepositoryPath();
    const spawnProcess = vi.fn(() => createMockRunProcess());
    const app = await buildServer({
      spawnProcess,
    });
    server = app;

    await app.inject({
      method: "POST",
      url: "/api/repository/select",
      payload: {
        path: repositoryPath,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        verificationCommand: "npm test | tee test.log",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "Invalid run start request.",
      code: "VALIDATION_ERROR",
    });
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("accepts a valid run start request and marks the run active", async () => {
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
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "  Use goal.md as the source of truth.  ",
        runCount: 2,
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      status: "running",
      repositoryPath: path.normalize(repositoryPath),
      prompt: "Use goal.md as the source of truth.",
      runCount: 2,
      verificationCommand: "",
      autoCommit: false,
    });
  });

  it("accepts an explicit auto-commit toggle", async () => {
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
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        autoCommit: true,
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      status: "running",
      repositoryPath: path.normalize(repositoryPath),
      prompt: "Use goal.md as the source of truth.",
      runCount: 1,
      verificationCommand: "",
      autoCommit: true,
    });
  });

  it.each([
    ["empty verification command", "   ", ""],
    [
      "single verification command with arguments",
      "  npm test -- --runInBand  ",
      "npm test -- --runInBand",
    ],
    [
      "quoted verification argument",
      '  npm test -- --testNamePattern "run loop"  ',
      'npm test -- --testNamePattern "run loop"',
    ],
  ])("accepts an optional %s", async (_name, verificationCommand, expected) => {
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
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        verificationCommand,
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      status: "running",
      repositoryPath: path.normalize(repositoryPath),
      prompt: "Use goal.md as the source of truth.",
      runCount: 1,
      verificationCommand: expected,
      autoCommit: false,
    });
  });

  it("spawns codex exec in the selected repository for the first run", async () => {
    const repositoryPath = await createRepositoryPath();
    const spawnProcess = vi.fn(() => createMockRunProcess());
    const app = await buildServer({
      spawnProcess,
    });
    server = app;

    await app.inject({
      method: "POST",
      url: "/api/repository/select",
      payload: {
        path: repositoryPath,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "  Use goal.md as the source of truth.  ",
        runCount: 2,
      },
    });

    expect(response.statusCode).toBe(202);
    expect(spawnProcess).toHaveBeenCalledWith(
      "codex",
      ["exec", "Use goal.md as the source of truth."],
      {
        cwd: path.normalize(repositoryPath),
        windowsHide: true,
      },
    );
  });

  it("streams Codex stdout and stderr to connected SSE clients", async () => {
    const repositoryPath = await createRepositoryPath();
    const runProcess = createMockRunProcess();
    const app = await buildServer({
      spawnProcess: vi.fn(() => runProcess),
    });
    server = app;
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
    await readSseChunk(reader);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
      },
    });
    await readSseChunk(reader);

    runProcess.stdout.write("stdout line\n");
    const stdoutChunk = await readSseChunk(reader);

    runProcess.stderr.write("stderr line\n");
    const stderrChunk = await readSseChunk(reader);
    await reader.cancel();

    expect(parseSsePayloads(stdoutChunk, "logs")).toEqual([
      {
        entries: [
          {
            id: 1,
            stream: "stdout",
            message: "stdout line\n",
          },
        ],
      },
    ]);
    expect(parseSsePayloads(stderrChunk, "logs")).toEqual([
      {
        entries: [
          {
            id: 2,
            stream: "stderr",
            message: "stderr line\n",
          },
        ],
      },
    ]);
  });

  it("stops immediately and reports failure when Codex exits with a non-zero code", async () => {
    const repositoryPath = await createRepositoryPath();
    const runProcess = createMockRunProcess();
    const app = await buildServer({
      spawnProcess: vi.fn(() => runProcess),
    });
    server = app;

    await app.inject({
      method: "POST",
      url: "/api/repository/select",
      payload: {
        path: repositoryPath,
      },
    });

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 2,
      },
    });

    runProcess.emit("close", 7, null);

    const origin = await listenOnRandomPort(app);
    const response = await globalThis.fetch(`${origin}/api/events`);
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error("Missing SSE response body.");
    }

    const snapshotChunk = await readSseChunk(reader);
    await reader.cancel();

    expect(parseSsePayloads(snapshotChunk, "status")).toEqual([
      {
        status: "failed",
        selectedRepositoryPath: path.normalize(repositoryPath),
      },
    ]);
    expect(parseSsePayloads(snapshotChunk, "summary")).toEqual([
      {
        status: "failed",
        message: "Codex run 1 exited with code 7.",
      },
    ]);

    const restartResponse = await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
      },
    });

    expect(restartResponse.statusCode).toBe(202);
  });

  it("re-reads goal.md after a successful Codex run", async () => {
    const repositoryPath = await createRepositoryPath();
    const goalMarkdown = "# Selected Goal\n\n- [ ] Next step\n";
    await writeFile(path.join(repositoryPath, "goal.md"), goalMarkdown);
    const runProcess = createMockRunProcess();
    const app = await buildServer({
      spawnProcess: vi.fn(() => runProcess),
    });
    server = app;
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
    await readSseChunk(reader);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
      },
    });
    await readUntilSsePayloads(reader, "summary");

    runProcess.emit("close", 0, null);
    const summaryPayloads = await readUntilSsePayloads(reader, "summary");
    await reader.cancel();

    expect(summaryPayloads).toEqual([
      {
        status: "complete",
        message: `Completed Codex run 1 of 1 and refreshed goal.md (${goalMarkdown.length} characters).`,
      },
    ]);
  });

  it("runs verification only after a successful Codex run in the selected repository", async () => {
    const repositoryPath = await createRepositoryPath();
    const goalMarkdown = "# Selected Goal\n\n- [ ] Next step\n";
    await writeFile(path.join(repositoryPath, "goal.md"), goalMarkdown);
    const runProcess = createMockRunProcess(321);
    const verificationProcess = createMockRunProcess(654);
    const spawnProcess = vi
      .fn()
      .mockReturnValueOnce(runProcess)
      .mockReturnValueOnce(verificationProcess);
    const app = await buildServer({
      spawnProcess,
    });
    server = app;
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
    await readSseChunk(reader);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        verificationCommand: "npm test -- --runInBand",
      },
    });
    await readUntilSsePayloads(reader, "summary");

    expect(spawnProcess).toHaveBeenCalledTimes(1);

    runProcess.emit("close", 0, null);
    const verificationSummaryPayloads = await readUntilSsePayloads(reader, "summary");

    expect(spawnProcess).toHaveBeenCalledTimes(2);
    expect(spawnProcess).toHaveBeenNthCalledWith(
      2,
      "npm",
      ["test", "--", "--runInBand"],
      {
        cwd: path.normalize(repositoryPath),
        windowsHide: true,
      },
    );
    expect(verificationSummaryPayloads).toEqual([
      {
        status: "running",
        message: "Started verification after Codex run 1 of 1.",
      },
    ]);

    verificationProcess.emit("close", 0, null);
    const completeSummaryPayloads = await readUntilSsePayloads(reader, "summary");
    await reader.cancel();

    expect(completeSummaryPayloads).toEqual([
      {
        status: "complete",
        message: `Completed Codex run 1 of 1 and refreshed goal.md (${goalMarkdown.length} characters).`,
      },
    ]);
  });

  it("runs auto-commit only after Codex and optional verification succeed", async () => {
    const repositoryPath = await createRepositoryPath();
    const goalMarkdown = "# Selected Goal\n\n- [ ] Next step\n";
    await writeFile(path.join(repositoryPath, "goal.md"), goalMarkdown);
    const runProcess = createMockRunProcess(321);
    const verificationProcess = createMockRunProcess(654);
    const gitAddProcess = createMockRunProcess(987);
    const gitStatusProcess = createMockRunProcess(765);
    const gitCommitProcess = createMockRunProcess(432);
    const spawnProcess = vi
      .fn()
      .mockReturnValueOnce(runProcess)
      .mockReturnValueOnce(verificationProcess)
      .mockReturnValueOnce(gitAddProcess)
      .mockReturnValueOnce(gitStatusProcess)
      .mockReturnValueOnce(gitCommitProcess);
    const app = await buildServer({
      spawnProcess,
    });
    server = app;
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
    await readSseChunk(reader);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        verificationCommand: "npm test",
        autoCommit: true,
      },
    });
    await readUntilSsePayloads(reader, "summary");

    runProcess.emit("close", 0, null);
    await readUntilSsePayloads(reader, "summary");

    expect(spawnProcess).toHaveBeenCalledTimes(2);

    verificationProcess.emit("close", 0, null);
    const gitAddSummaryPayloads = await readUntilSsePayloads(reader, "summary");

    expect(spawnProcess).toHaveBeenCalledTimes(3);
    expect(spawnProcess).toHaveBeenNthCalledWith(3, "git", ["add", "-A"], {
      cwd: path.normalize(repositoryPath),
      windowsHide: true,
    });
    expect(gitAddSummaryPayloads).toEqual([
      {
        status: "running",
        message: "Started auto-commit staging after Codex run 1 of 1.",
      },
    ]);

    gitAddProcess.emit("close", 0, null);
    const gitStatusSummaryPayloads = await readUntilSsePayloads(reader, "summary");

    expect(spawnProcess).toHaveBeenCalledTimes(4);
    expect(spawnProcess).toHaveBeenNthCalledWith(
      4,
      "git",
      ["status", "--porcelain"],
      {
        cwd: path.normalize(repositoryPath),
        windowsHide: true,
      },
    );
    expect(gitStatusSummaryPayloads).toEqual([
      {
        status: "running",
        message: "Started auto-commit status check after Codex run 1 of 1.",
      },
    ]);

    gitStatusProcess.stdout.write(" M goal.md\n");
    gitStatusProcess.emit("close", 0, null);
    const gitCommitSummaryPayloads = await readUntilSsePayloads(reader, "summary");

    expect(spawnProcess).toHaveBeenCalledTimes(5);
    expect(spawnProcess).toHaveBeenNthCalledWith(
      5,
      "git",
      [
        "commit",
        "-m",
        "codex-goal-runner: apply Codex run 1 of 1",
        "-m",
        "Generated by codex-goal-runner after Codex and optional verification succeeded.",
      ],
      {
        cwd: path.normalize(repositoryPath),
        windowsHide: true,
      },
    );
    expect(gitCommitSummaryPayloads).toEqual([
      {
        status: "running",
        message: "Started auto-commit after Codex run 1 of 1.",
      },
    ]);

    gitCommitProcess.emit("close", 0, null);
    const completeSummaryPayloads = await readUntilSsePayloads(reader, "summary");
    await reader.cancel();

    expect(completeSummaryPayloads).toEqual([
      {
        status: "complete",
        message: `Completed Codex run 1 of 1 and refreshed goal.md (${goalMarkdown.length} characters).`,
      },
    ]);
  });

  it("streams git stdout and stderr to connected SSE clients during auto-commit", async () => {
    const repositoryPath = await createRepositoryPath();
    await writeFile(path.join(repositoryPath, "goal.md"), "# Selected Goal\n");
    const runProcess = createMockRunProcess(321);
    const gitAddProcess = createMockRunProcess(987);
    const gitStatusProcess = createMockRunProcess(765);
    const gitCommitProcess = createMockRunProcess(432);
    const spawnProcess = vi
      .fn()
      .mockReturnValueOnce(runProcess)
      .mockReturnValueOnce(gitAddProcess)
      .mockReturnValueOnce(gitStatusProcess)
      .mockReturnValueOnce(gitCommitProcess);
    const app = await buildServer({
      spawnProcess,
    });
    server = app;
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
    await readSseChunk(reader);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        autoCommit: true,
      },
    });
    await readUntilSsePayloads(reader, "summary");

    runProcess.emit("close", 0, null);
    await readUntilSsePayloads(reader, "summary");

    gitAddProcess.emit("close", 0, null);
    await readUntilSsePayloads(reader, "summary");

    gitStatusProcess.stdout.write(" M goal.md\n");
    const gitStatusLogPayloads = await readUntilSsePayloads(reader, "logs");
    gitStatusProcess.emit("close", 0, null);
    await readUntilSsePayloads(reader, "summary");

    gitCommitProcess.stdout.write("[main 1234567] apply goal change\n");
    const gitCommitStdoutPayloads = await readUntilSsePayloads(reader, "logs");

    gitCommitProcess.stderr.write("git warning\n");
    const gitCommitStderrPayloads = await readUntilSsePayloads(reader, "logs");
    await reader.cancel();

    expect(gitStatusLogPayloads).toEqual([
      {
        entries: [
          {
            id: 1,
            stream: "stdout",
            message: " M goal.md\n",
          },
        ],
      },
    ]);
    expect(gitCommitStdoutPayloads).toEqual([
      {
        entries: [
          {
            id: 2,
            stream: "stdout",
            message: "[main 1234567] apply goal change\n",
          },
        ],
      },
    ]);
    expect(gitCommitStderrPayloads).toEqual([
      {
        entries: [
          {
            id: 3,
            stream: "stderr",
            message: "git warning\n",
          },
        ],
      },
    ]);
  });

  it("skips auto-commit when git status reports no changes", async () => {
    const repositoryPath = await createRepositoryPath();
    const goalMarkdown = "# Selected Goal\n\n- [ ] Next step\n";
    await writeFile(path.join(repositoryPath, "goal.md"), goalMarkdown);
    const runProcess = createMockRunProcess(321);
    const gitAddProcess = createMockRunProcess(987);
    const gitStatusProcess = createMockRunProcess(765);
    const spawnProcess = vi
      .fn()
      .mockReturnValueOnce(runProcess)
      .mockReturnValueOnce(gitAddProcess)
      .mockReturnValueOnce(gitStatusProcess);
    const app = await buildServer({
      spawnProcess,
    });
    server = app;
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
    await readSseChunk(reader);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        autoCommit: true,
      },
    });
    await readUntilSsePayloads(reader, "summary");

    runProcess.emit("close", 0, null);
    const gitAddSummaryPayloads = await readUntilSsePayloads(reader, "summary");

    expect(spawnProcess).toHaveBeenCalledTimes(2);
    expect(spawnProcess).toHaveBeenNthCalledWith(2, "git", ["add", "-A"], {
      cwd: path.normalize(repositoryPath),
      windowsHide: true,
    });
    expect(gitAddSummaryPayloads).toEqual([
      {
        status: "running",
        message: "Started auto-commit staging after Codex run 1 of 1.",
      },
    ]);

    gitAddProcess.emit("close", 0, null);
    const gitStatusSummaryPayloads = await readUntilSsePayloads(reader, "summary");

    expect(spawnProcess).toHaveBeenCalledTimes(3);
    expect(spawnProcess).toHaveBeenNthCalledWith(
      3,
      "git",
      ["status", "--porcelain"],
      {
        cwd: path.normalize(repositoryPath),
        windowsHide: true,
      },
    );
    expect(gitStatusSummaryPayloads).toEqual([
      {
        status: "running",
        message: "Started auto-commit status check after Codex run 1 of 1.",
      },
    ]);

    gitStatusProcess.emit("close", 0, null);
    const skipSummaryPayloads = await readUntilSsePayloads(reader, "summary");
    const completeSummaryPayloads = await readUntilSsePayloads(reader, "summary");
    await reader.cancel();

    expect(spawnProcess).toHaveBeenCalledTimes(3);
    expect(skipSummaryPayloads).toEqual([
      {
        status: "running",
        message:
          "Skipped auto-commit after Codex run 1 of 1 because git status reported no changes.",
      },
    ]);
    expect(completeSummaryPayloads).toEqual([
      {
        status: "complete",
        message: `Completed Codex run 1 of 1 and refreshed goal.md (${goalMarkdown.length} characters).`,
      },
    ]);
  });

  it("stops the run loop when auto-commit fails", async () => {
    const repositoryPath = await createRepositoryPath();
    await writeFile(path.join(repositoryPath, "goal.md"), "# Selected Goal\n");
    const runProcess = createMockRunProcess(321);
    const gitAddProcess = createMockRunProcess(987);
    const gitStatusProcess = createMockRunProcess(765);
    const gitCommitProcess = createMockRunProcess(432);
    const nextRunProcess = createMockRunProcess(654);
    const spawnProcess = vi
      .fn()
      .mockReturnValueOnce(runProcess)
      .mockReturnValueOnce(gitAddProcess)
      .mockReturnValueOnce(gitStatusProcess)
      .mockReturnValueOnce(gitCommitProcess)
      .mockReturnValueOnce(nextRunProcess);
    const app = await buildServer({
      spawnProcess,
    });
    server = app;
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
    await readSseChunk(reader);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 2,
        autoCommit: true,
      },
    });
    await readUntilSsePayloads(reader, "summary");

    runProcess.emit("close", 0, null);
    await readUntilSsePayloads(reader, "summary");

    gitAddProcess.emit("close", 0, null);
    await readUntilSsePayloads(reader, "summary");

    gitStatusProcess.stdout.write(" M goal.md\n");
    await readUntilSsePayloads(reader, "logs");
    gitStatusProcess.emit("close", 0, null);
    await readUntilSsePayloads(reader, "summary");

    gitCommitProcess.emit("close", 1, null);
    const summaryPayloads = await readUntilSsePayloads(reader, "summary");
    await reader.cancel();

    expect(spawnProcess).toHaveBeenCalledTimes(4);
    expect(summaryPayloads).toEqual([
      {
        status: "failed",
        message: "Auto-commit after Codex run 1 exited with code 1.",
      },
    ]);
  });

  it("streams verification stdout and stderr to connected SSE clients", async () => {
    const repositoryPath = await createRepositoryPath();
    await writeFile(path.join(repositoryPath, "goal.md"), "# Selected Goal\n");
    const runProcess = createMockRunProcess(321);
    const verificationProcess = createMockRunProcess(654);
    const spawnProcess = vi
      .fn()
      .mockReturnValueOnce(runProcess)
      .mockReturnValueOnce(verificationProcess);
    const app = await buildServer({
      spawnProcess,
    });
    server = app;
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
    await readSseChunk(reader);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        verificationCommand: "npm test",
      },
    });
    await readUntilSsePayloads(reader, "summary");

    runProcess.emit("close", 0, null);
    await readUntilSsePayloads(reader, "summary");

    verificationProcess.stdout.write("verification stdout\n");
    const stdoutChunk = await readSseChunk(reader);

    verificationProcess.stderr.write("verification stderr\n");
    const stderrChunk = await readSseChunk(reader);
    await reader.cancel();

    expect(parseSsePayloads(stdoutChunk, "logs")).toEqual([
      {
        entries: [
          {
            id: 1,
            stream: "stdout",
            message: "verification stdout\n",
          },
        ],
      },
    ]);
    expect(parseSsePayloads(stderrChunk, "logs")).toEqual([
      {
        entries: [
          {
            id: 2,
            stream: "stderr",
            message: "verification stderr\n",
          },
        ],
      },
    ]);
  });

  it("stops the run loop when verification fails", async () => {
    const repositoryPath = await createRepositoryPath();
    await writeFile(path.join(repositoryPath, "goal.md"), "# Selected Goal\n");
    const runProcess = createMockRunProcess(321);
    const verificationProcess = createMockRunProcess(654);
    const nextRunProcess = createMockRunProcess(987);
    const spawnProcess = vi
      .fn()
      .mockReturnValueOnce(runProcess)
      .mockReturnValueOnce(verificationProcess)
      .mockReturnValueOnce(nextRunProcess);
    const app = await buildServer({
      spawnProcess,
    });
    server = app;
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
    await readSseChunk(reader);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 2,
        verificationCommand: "npm test",
        autoCommit: true,
      },
    });
    await readUntilSsePayloads(reader, "summary");

    runProcess.emit("close", 0, null);
    await readUntilSsePayloads(reader, "summary");

    verificationProcess.emit("close", 1, null);
    const summaryPayloads = await readUntilSsePayloads(reader, "summary");
    await reader.cancel();

    expect(spawnProcess).toHaveBeenCalledTimes(2);
    expect(summaryPayloads).toEqual([
      {
        status: "failed",
        message: "Verification after Codex run 1 exited with code 1.",
      },
    ]);
  });

  it("does not run verification after a failed Codex run", async () => {
    const repositoryPath = await createRepositoryPath();
    const runProcess = createMockRunProcess();
    const spawnProcess = vi.fn(() => runProcess);
    const app = await buildServer({
      spawnProcess,
    });
    server = app;

    await app.inject({
      method: "POST",
      url: "/api/repository/select",
      payload: {
        path: repositoryPath,
      },
    });

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        verificationCommand: "npm test",
      },
    });

    runProcess.emit("close", 7, null);
    await Promise.resolve();

    expect(spawnProcess).toHaveBeenCalledTimes(1);
  });

  it("continues with the next Codex run only when no stop condition is present", async () => {
    const repositoryPath = await createRepositoryPath();
    const goalMarkdown = "# Selected Goal\n\n- [ ] Next step\n";
    await writeFile(path.join(repositoryPath, "goal.md"), goalMarkdown);
    const firstRunProcess = createMockRunProcess(321);
    const secondRunProcess = createMockRunProcess(654);
    const spawnProcess = vi
      .fn()
      .mockReturnValueOnce(firstRunProcess)
      .mockReturnValueOnce(secondRunProcess);
    const app = await buildServer({
      spawnProcess,
    });
    server = app;
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
    await readSseChunk(reader);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 2,
      },
    });
    await readUntilSsePayloads(reader, "summary");

    firstRunProcess.emit("close", 0, null);
    const nextRunSummaryPayloads = await readUntilSsePayloads(reader, "summary");

    expect(spawnProcess).toHaveBeenCalledTimes(2);
    expect(spawnProcess).toHaveBeenNthCalledWith(
      2,
      "codex",
      ["exec", "Use goal.md as the source of truth."],
      {
        cwd: path.normalize(repositoryPath),
        windowsHide: true,
      },
    );
    expect(nextRunSummaryPayloads).toEqual([
      {
        status: "running",
        message: "Started Codex run 2 of 2.",
      },
    ]);

    const snapshotResponse = await globalThis.fetch(`${origin}/api/events`);
    const snapshotReader = snapshotResponse.body?.getReader();

    if (!snapshotReader) {
      throw new Error("Missing SSE response body.");
    }

    const snapshotChunk = await readSseChunk(snapshotReader);
    expect(parseSsePayloads(snapshotChunk, "progress")).toEqual([
      {
        currentRun: 2,
        totalRuns: 2,
      },
    ]);

    secondRunProcess.emit("close", 0, null);
    const completeSummaryPayloads = await readUntilSsePayloads(reader, "summary");
    await reader.cancel();
    await snapshotReader.cancel();

    expect(completeSummaryPayloads).toEqual([
      {
        status: "complete",
        message: `Completed Codex run 2 of 2 and refreshed goal.md (${goalMarkdown.length} characters).`,
      },
    ]);
  });

  it("stops with complete status when refreshed goal.md contains GOAL_COMPLETE", async () => {
    const repositoryPath = await createRepositoryPath();
    await writeFile(
      path.join(repositoryPath, "goal.md"),
      "# Selected Goal\n\nGOAL_COMPLETE\n",
    );
    const runProcess = createMockRunProcess();
    const spawnProcess = vi.fn(() => runProcess);
    const app = await buildServer({
      spawnProcess,
    });
    server = app;
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
    await readSseChunk(reader);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 3,
      },
    });
    await readUntilSsePayloads(reader, "summary");

    runProcess.emit("close", 0, null);
    const summaryPayloads = await readUntilSsePayloads(reader, "summary");
    await reader.cancel();

    expect(summaryPayloads).toEqual([
      {
        status: "complete",
        message:
          "Stopped after Codex run 1 of 3 because refreshed goal.md contains GOAL_COMPLETE.",
      },
    ]);
    expect(spawnProcess).toHaveBeenCalledTimes(1);
  });

  it("stops with blocked status when refreshed goal.md contains GOAL_BLOCKED", async () => {
    const repositoryPath = await createRepositoryPath();
    await writeFile(
      path.join(repositoryPath, "goal.md"),
      "# Selected Goal\n\nGOAL_BLOCKED: waiting for user input\n",
    );
    const runProcess = createMockRunProcess();
    const spawnProcess = vi.fn(() => runProcess);
    const app = await buildServer({
      spawnProcess,
    });
    server = app;
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
    await readSseChunk(reader);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 3,
      },
    });
    await readUntilSsePayloads(reader, "summary");

    runProcess.emit("close", 0, null);
    const summaryPayloads = await readUntilSsePayloads(reader, "summary");
    await reader.cancel();

    expect(summaryPayloads).toEqual([
      {
        status: "blocked",
        message:
          "Stopped after Codex run 1 of 3 because refreshed goal.md contains GOAL_BLOCKED.",
      },
    ]);
    expect(spawnProcess).toHaveBeenCalledTimes(1);
  });

  it("fails the run when goal.md cannot be re-read after a successful Codex run", async () => {
    const repositoryPath = await createRepositoryPath();
    const runProcess = createMockRunProcess();
    const app = await buildServer({
      spawnProcess: vi.fn(() => runProcess),
    });
    server = app;
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
    await readSseChunk(reader);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
      },
    });
    await readUntilSsePayloads(reader, "summary");

    runProcess.emit("close", 0, null);
    const summaryPayloads = await readUntilSsePayloads(reader, "summary");
    await reader.cancel();

    expect(summaryPayloads).toEqual([
      {
        status: "failed",
        message: "goal.md became unavailable after Codex run 1.",
      },
    ]);
  });

  it("rejects a second run start request while a run is active", async () => {
    const repositoryPath = await createRepositoryPath();
    const app = await getServer();

    await app.inject({
      method: "POST",
      url: "/api/repository/select",
      payload: {
        path: repositoryPath,
      },
    });

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
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "A run is already active.",
    });
  });

  it("does not start another Codex run while stop is requested and reports stopped after close", async () => {
    const repositoryPath = await createRepositoryPath();
    const goalMarkdown = "# Selected Goal\n\n- [ ] Next step\n";
    await writeFile(path.join(repositoryPath, "goal.md"), goalMarkdown);
    const firstRunProcess = createMockRunProcess(321);
    const secondRunProcess = createMockRunProcess(654);
    const spawnProcess = vi
      .fn()
      .mockReturnValueOnce(firstRunProcess)
      .mockReturnValueOnce(secondRunProcess);
    const app = await buildServer({
      spawnProcess,
    });
    server = app;
    const origin = await listenOnRandomPort(app);

    const sseResponse = await globalThis.fetch(`${origin}/api/events`);
    const reader = sseResponse.body?.getReader();

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
    await readSseChunk(reader);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 2,
      },
    });
    await readUntilSsePayloads(reader, "summary");

    await app.inject({
      method: "POST",
      url: "/api/run/stop",
    });
    await readUntilSsePayloads(reader, "summary");

    const activeRestartResponse = await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
      },
    });

    firstRunProcess.emit("close", 0, null);
    const summaryPayloads = await readUntilSsePayloads(reader, "summary");

    const restartResponse = await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
      },
    });
    await reader.cancel();

    expect(activeRestartResponse.statusCode).toBe(409);
    expect(activeRestartResponse.json()).toEqual({
      error: "A run is already active.",
    });
    expect(restartResponse.statusCode).toBe(202);
    expect(spawnProcess).toHaveBeenCalledTimes(2);
    expect(summaryPayloads).toEqual([
      {
        status: "stopped",
        message:
          "Stopped after Codex run 1 of 2 because stop was requested; no additional Codex runs will start.",
      },
    ]);
  });

  it("rejects a stop request when no run is active", async () => {
    const app = await getServer();

    const response = await app.inject({
      method: "POST",
      url: "/api/run/stop",
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "No active run to stop.",
    });
  });

  it("rejects caller-provided stop options", async () => {
    const repositoryPath = await createRepositoryPath();
    const runProcess = createMockRunProcess();
    const app = await buildServer({
      spawnProcess: vi.fn(() => runProcess),
    });
    server = app;

    await app.inject({
      method: "POST",
      url: "/api/repository/select",
      payload: {
        path: repositoryPath,
      },
    });

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
      },
    });

    const bodyResponse = await app.inject({
      method: "POST",
      url: "/api/run/stop",
      payload: {
        signal: "SIGKILL",
      },
    });
    const queryResponse = await app.inject({
      method: "POST",
      url: "/api/run/stop?signal=SIGKILL",
    });

    expect(bodyResponse.statusCode).toBe(400);
    expect(bodyResponse.json()).toEqual({
      error: "Invalid run stop request.",
      code: "VALIDATION_ERROR",
      issues: [
        {
          path: "request",
          message: "Unrecognized key(s) in object: 'signal'",
        },
      ],
    });
    expect(queryResponse.statusCode).toBe(400);
    expect(queryResponse.json()).toEqual({
      error: "Invalid run stop request.",
      code: "VALIDATION_ERROR",
      issues: [
        {
          path: "request",
          message: "Unrecognized key(s) in object: 'signal'",
        },
      ],
    });
    expect(runProcess.kill).not.toHaveBeenCalled();
  });

  it("marks the run as stopping and terminates the active Codex process", async () => {
    const repositoryPath = await createRepositoryPath();
    const runProcess = createMockRunProcess(987);
    const app = await buildServer({
      spawnProcess: vi.fn(() => runProcess),
    });
    server = app;
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
    await readSseChunk(reader);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 2,
      },
    });
    await readUntilSsePayloads(reader, "summary");

    const stopResponse = await app.inject({
      method: "POST",
      url: "/api/run/stop",
    });
    const summaryPayloads = await readUntilSsePayloads(reader, "summary");

    runProcess.emit("close", null, "SIGTERM");
    const stoppedSummaryPayloads = await readUntilSsePayloads(reader, "summary");

    expect(stopResponse.statusCode).toBe(202);
    expect(stopResponse.json()).toEqual({
      status: "stopping",
      activeProcessId: 987,
      killSignalSent: true,
    });
    expect(runProcess.kill).toHaveBeenCalledTimes(1);
    expect(summaryPayloads).toEqual([
      {
        status: "stopping",
        message: "Stop requested; terminating the active Codex process.",
      },
    ]);
    expect(stoppedSummaryPayloads).toEqual([
      {
        status: "stopped",
        message:
          "Stopped after Codex run 1 of 2 because stop was requested; no additional Codex runs will start.",
      },
    ]);

    const snapshotResponse = await globalThis.fetch(`${origin}/api/events`);
    const snapshotReader = snapshotResponse.body?.getReader();

    if (!snapshotReader) {
      throw new Error("Missing SSE response body.");
    }

    const snapshotChunk = await readSseChunk(snapshotReader);
    await snapshotReader.cancel();

    expect(parseSsePayloads(snapshotChunk, "status")).toEqual([
      {
        status: "stopped",
        selectedRepositoryPath: path.normalize(repositoryPath),
      },
    ]);
    expect(parseSsePayloads(snapshotChunk, "summary")).toEqual([
      {
        status: "stopped",
        message:
          "Stopped after Codex run 1 of 2 because stop was requested; no additional Codex runs will start.",
      },
    ]);
    await reader.cancel();
  });
});
