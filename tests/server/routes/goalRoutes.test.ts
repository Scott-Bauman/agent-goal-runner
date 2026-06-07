import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createTestServer } from "../helpers/fastify";
import { browseRepository } from "../helpers/repositoryBrowse";
import {
  createEscapingGoalPath,
  createRepositoryPath,
} from "../helpers/tempRepository";
import { useServerTestLifecycle } from "../helpers/lifecycle";

useServerTestLifecycle();

describe("goal read endpoint", () => {
  it("requires a selected repository", async () => {
    const app = await createTestServer();

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
    const app = await createTestServer();

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "GET",
      url: "/api/goal",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      repositoryPath: path.normalize(repositoryPath),
      goalPath: path.join(path.normalize(repositoryPath), "goal.md"),
      markdown: "# Selected Goal\n",
      revision: expect.any(String),
    });
  });

  it("returns a clear missing-goal state when goal.md does not exist", async () => {
    const repositoryPath = await createRepositoryPath();
    const app = await createTestServer();

    await browseRepository(app, repositoryPath);

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
    const app = await createTestServer();

    await browseRepository(app, repositoryPath);

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
    const app = await createTestServer();

    await browseRepository(app, repositoryPath);

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

  it("rejects a goal.md path that resolves outside the selected repository", async () => {
    const repositoryPath = await createRepositoryPath();
    const goalPath = await createEscapingGoalPath(repositoryPath);
    const app = await createTestServer();

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "GET",
      url: "/api/goal",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "goal.md resolves outside the selected repository.",
      code: "GOAL_PATH_RESTRICTED",
      repositoryPath: path.normalize(repositoryPath),
      goalPath: path.normalize(goalPath),
    });
  });
});

describe("goal creation endpoint", () => {
  it("requires a selected repository", async () => {
    const app = await createTestServer();

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
    const app = await createTestServer();

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "POST",
      url: "/api/goal",
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      repositoryPath: path.normalize(repositoryPath),
      goalPath,
      exists: true,
      revision: expect.any(String),
    });
    expect(response.json().markdown).toContain("# Project Goal");
    expect(await readFile(goalPath, "utf8")).toBe(response.json().markdown);
  });

  it("creates a goal.md with provided markdown", async () => {
    const repositoryPath = await createRepositoryPath();
    const goalPath = path.join(path.normalize(repositoryPath), "goal.md");
    const markdown = "# Manual Goal\n\n- [ ] Write the first step.\n";
    const app = await createTestServer();

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "POST",
      url: "/api/goal",
      payload: {
        markdown,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      repositoryPath: path.normalize(repositoryPath),
      goalPath,
      markdown,
      revision: expect.any(String),
      exists: true,
    });
    expect(await readFile(goalPath, "utf8")).toBe(markdown);
  });

  it("rejects invalid creation bodies", async () => {
    const repositoryPath = await createRepositoryPath();
    const app = await createTestServer();

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "POST",
      url: "/api/goal",
      payload: {
        markdown: 123,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Invalid goal creation request.",
      code: "VALIDATION_ERROR",
      issues: [
        {
          path: "markdown",
          message: "Goal markdown must be a string.",
        },
      ],
    });
  });

  it("rejects caller-provided creation paths and alternate names", async () => {
    const repositoryPath = await createRepositoryPath();
    const app = await createTestServer();

    await browseRepository(app, repositoryPath);

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
    const app = await createTestServer();

    await browseRepository(app, repositoryPath);

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

  it("rejects creation when goal.md resolves outside the selected repository", async () => {
    const repositoryPath = await createRepositoryPath();
    const goalPath = await createEscapingGoalPath(repositoryPath);
    const app = await createTestServer();

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "POST",
      url: "/api/goal",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "goal.md resolves outside the selected repository.",
      code: "GOAL_PATH_RESTRICTED",
      repositoryPath: path.normalize(repositoryPath),
      goalPath: path.normalize(goalPath),
    });
  });
});

describe("goal update endpoint", () => {
  it("requires a selected repository", async () => {
    const app = await createTestServer();

    const response = await app.inject({
      method: "PUT",
      url: "/api/goal",
      payload: {
        expectedRevision: "revision",
        markdown: "# Goal\n",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "No repository selected.",
    });
  });

  it("updates existing goal.md when the expected revision matches", async () => {
    const repositoryPath = await createRepositoryPath();
    const goalPath = path.join(path.normalize(repositoryPath), "goal.md");
    await writeFile(goalPath, "# Old Goal\n");
    const app = await createTestServer();

    await browseRepository(app, repositoryPath);
    const readResponse = await app.inject({
      method: "GET",
      url: "/api/goal",
    });
    const nextMarkdown = "# New Goal\n\n- [ ] Next\n";

    const response = await app.inject({
      method: "PUT",
      url: "/api/goal",
      payload: {
        expectedRevision: readResponse.json().revision,
        markdown: nextMarkdown,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      repositoryPath: path.normalize(repositoryPath),
      goalPath,
      markdown: nextMarkdown,
      revision: expect.any(String),
      exists: true,
    });
    expect(response.json().revision).not.toBe(readResponse.json().revision);
    expect(await readFile(goalPath, "utf8")).toBe(nextMarkdown);
  });

  it("rejects stale revisions without overwriting goal.md", async () => {
    const repositoryPath = await createRepositoryPath();
    const goalPath = path.join(path.normalize(repositoryPath), "goal.md");
    await writeFile(goalPath, "# Old Goal\n");
    const app = await createTestServer();

    await browseRepository(app, repositoryPath);
    const readResponse = await app.inject({
      method: "GET",
      url: "/api/goal",
    });
    await writeFile(goalPath, "# Changed Elsewhere\n");

    const response = await app.inject({
      method: "PUT",
      url: "/api/goal",
      payload: {
        expectedRevision: readResponse.json().revision,
        markdown: "# New Goal\n",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "goal.md changed before the update could be saved.",
      code: "GOAL_REVISION_MISMATCH",
      repositoryPath: path.normalize(repositoryPath),
      goalPath,
      expectedRevision: readResponse.json().revision,
      actualRevision: expect.any(String),
    });
    expect(await readFile(goalPath, "utf8")).toBe("# Changed Elsewhere\n");
  });

  it("returns a missing-goal state when updating without goal.md", async () => {
    const repositoryPath = await createRepositoryPath();
    const goalPath = path.join(path.normalize(repositoryPath), "goal.md");
    const app = await createTestServer();

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "PUT",
      url: "/api/goal",
      payload: {
        expectedRevision: "revision",
        markdown: "# Goal\n",
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: "goal.md does not exist in the selected repository.",
      code: "GOAL_MISSING",
      repositoryPath: path.normalize(repositoryPath),
      goalPath,
      exists: false,
    });
  });

  it("rejects invalid update bodies and caller-provided paths", async () => {
    const repositoryPath = await createRepositoryPath();
    await writeFile(path.join(repositoryPath, "goal.md"), "# Goal\n");
    const app = await createTestServer();

    await browseRepository(app, repositoryPath);

    const invalidBodyResponse = await app.inject({
      method: "PUT",
      url: "/api/goal",
      payload: {
        markdown: "# Goal\n",
      },
    });
    const pathResponse = await app.inject({
      method: "PUT",
      url: "/api/goal",
      payload: {
        expectedRevision: "revision",
        markdown: "# Goal\n",
        path: path.join(repositoryPath, "refactor.md"),
      },
    });
    const nameResponse = await app.inject({
      method: "PUT",
      url: "/api/goal?name=refactor.md",
      payload: {
        expectedRevision: "revision",
        markdown: "# Goal\n",
      },
    });

    expect(invalidBodyResponse.statusCode).toBe(400);
    expect(invalidBodyResponse.json()).toEqual({
      error: "Invalid goal update request.",
      code: "VALIDATION_ERROR",
      issues: [
        {
          path: "expectedRevision",
          message: "Expected revision is required.",
        },
      ],
    });
    expect(pathResponse.statusCode).toBe(400);
    expect(pathResponse.json()).toEqual({
      error: "Invalid goal update request.",
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
      error: "Invalid goal update request.",
      code: "VALIDATION_ERROR",
      issues: [
        {
          path: "request",
          message: "Unrecognized key(s) in object: 'name'",
        },
      ],
    });
  });

  it("rejects updates when goal.md resolves outside the selected repository", async () => {
    const repositoryPath = await createRepositoryPath();
    const goalPath = await createEscapingGoalPath(repositoryPath);
    const app = await createTestServer();

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "PUT",
      url: "/api/goal",
      payload: {
        expectedRevision: "revision",
        markdown: "# Goal\n",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "goal.md resolves outside the selected repository.",
      code: "GOAL_PATH_RESTRICTED",
      repositoryPath: path.normalize(repositoryPath),
      goalPath: path.normalize(goalPath),
    });
  });
});
