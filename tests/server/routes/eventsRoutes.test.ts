import path from "node:path";
import { describe, expect, it } from "vitest";

import { RUNNER_STATUSES } from "../../../src/server/runner/statuses";
import { emitLatestGoalWatcherEvent } from "../helpers/chokidarMock";
import { createTestServer, listenOnRandomPort } from "../helpers/fastify";
import { createRepositoryPath } from "../helpers/tempRepository";
import {
  parseSsePayloads,
  readSseChunk,
} from "../helpers/sse";
import { useServerTestLifecycle } from "../helpers/lifecycle";

useServerTestLifecycle();

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
    const app = await createTestServer();
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
    const app = await createTestServer();

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
    const app = await createTestServer();
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
      const app = await createTestServer();
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
    const app = await createTestServer();
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

