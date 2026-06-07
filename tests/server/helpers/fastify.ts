import type { FastifyInstance } from "fastify";
import type { AddressInfo } from "node:net";
import { vi } from "vitest";

import "./chokidarMock";
import { buildServer, type BuildServerOptions } from "../../../src/server/index";
import { createMockRunProcess } from "./process";
import { openRepositoryFolderDialogMock } from "./repositoryBrowse";

let server: FastifyInstance | undefined;

export async function createTestServer(
  options: BuildServerOptions = {},
): Promise<FastifyInstance> {
  server = await buildServer({
    openRepositoryFolderDialog: openRepositoryFolderDialogMock,
    spawnProcess: vi.fn(() => createMockRunProcess()),
    ...options,
  });
  return server;
}

export function trackTestServer(app: FastifyInstance): FastifyInstance {
  server = app;
  return app;
}

export async function closeTestServer(): Promise<void> {
  await server?.close();
  server = undefined;
}

export async function listenOnRandomPort(app: FastifyInstance): Promise<string> {
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
