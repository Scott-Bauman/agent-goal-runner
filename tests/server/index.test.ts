import type { FastifyInstance } from "fastify";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildServer } from "../../src/server/index";

let server: FastifyInstance | undefined;

async function getServer(): Promise<FastifyInstance> {
  server = await buildServer();
  return server;
}

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("repository selection endpoint", () => {
  it("accepts an absolute local filesystem path", async () => {
    const repositoryPath = path.resolve("example-repo");
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
});
