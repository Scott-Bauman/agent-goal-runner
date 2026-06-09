import { describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createTestServer } from "./helpers/fastify";
import { useServerTestLifecycle } from "./helpers/lifecycle";
import { createTempPath } from "./helpers/tempRepository";

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

  it("serves a built frontend from the backend when static assets are available", async () => {
    const webStaticRootPath = await createTempPath();
    await mkdir(path.join(webStaticRootPath, "assets"));
    await Promise.all([
      writeFile(
        path.join(webStaticRootPath, "index.html"),
        "<!doctype html><div id=\"root\"></div>",
      ),
      writeFile(path.join(webStaticRootPath, "assets", "app.js"), "export {};"),
    ]);
    const app = await createTestServer({
      webStaticRootPath,
    });

    const [rootResponse, assetResponse, clientRouteResponse, apiResponse] =
      await Promise.all([
        app.inject({
          method: "GET",
          url: "/",
        }),
        app.inject({
          method: "GET",
          url: "/assets/app.js",
        }),
        app.inject({
          headers: {
            accept: "text/html",
          },
          method: "GET",
          url: "/runs/history",
        }),
        app.inject({
          headers: {
            accept: "text/html",
          },
          method: "GET",
          url: "/api/repository/selection",
        }),
      ]);

    expect(rootResponse.statusCode).toBe(200);
    expect(rootResponse.headers["content-type"]).toContain("text/html");
    expect(rootResponse.body).toContain("<div id=\"root\"></div>");
    expect(assetResponse.statusCode).toBe(200);
    expect(assetResponse.body).toBe("export {};");
    expect(clientRouteResponse.statusCode).toBe(200);
    expect(clientRouteResponse.body).toContain("<div id=\"root\"></div>");
    expect(apiResponse.statusCode).toBe(200);
    expect(apiResponse.json()).toEqual({
      repositoryPath: null,
    });
  });

  it("keeps missing API paths as 404 responses when serving the built frontend", async () => {
    const webStaticRootPath = await createTempPath();
    await writeFile(
      path.join(webStaticRootPath, "index.html"),
      "<!doctype html><div id=\"root\"></div>",
    );
    const app = await createTestServer({
      webStaticRootPath,
    });

    const response = await app.inject({
      headers: {
        accept: "text/html",
      },
      method: "GET",
      url: "/api/unknown",
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toEqual({
      error: "Not Found",
      message: "Route GET:/api/unknown not found",
      statusCode: 404,
    });
  });
});
