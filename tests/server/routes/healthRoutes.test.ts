import { describe, expect, it } from "vitest";

import { createTestServer } from "../helpers/fastify";
import { useServerTestLifecycle } from "../helpers/lifecycle";

useServerTestLifecycle();

describe("health routes", () => {
  it("returns product metadata from the root endpoint", async () => {
    const app = await createTestServer();

    const response = await app.inject({
      method: "GET",
      url: "/",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      name: "codex-goal-runner",
      status: "ok",
    });
  });

  it("returns health status from /health", async () => {
    const app = await createTestServer();

    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
    });
  });
});
