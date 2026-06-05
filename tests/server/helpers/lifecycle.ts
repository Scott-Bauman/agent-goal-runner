import { afterEach, beforeEach } from "vitest";

import { closeTestServer } from "./fastify";
import { resetChokidarMocks } from "./chokidarMock";
import { cleanupTempPaths } from "./tempRepository";

export function useServerTestLifecycle(): void {
  beforeEach(() => {
    resetChokidarMocks();
  });

  afterEach(async () => {
    await closeTestServer();
    await cleanupTempPaths();
  });
}
