import { describe, expect, it } from "vitest";

import { createTestServer } from "./helpers/fastify";
import { useServerTestLifecycle } from "./helpers/lifecycle";

useServerTestLifecycle();

describe("buildServer", () => {
  it("composes the backend route modules into one Fastify instance", async () => {
    const app = await createTestServer();

    const [healthResponse, repositoryResponse] = await Promise.all([
      app.inject({
        method: "GET",
        url: "/health",
      }),
      app.inject({
        method: "GET",
        url: "/api/repository/selection",
      }),
    ]);

    expect(healthResponse.statusCode).toBe(200);
    expect(repositoryResponse.statusCode).toBe(200);
    expect(repositoryResponse.json()).toEqual({
      repositoryPath: null,
    });
  });
});
