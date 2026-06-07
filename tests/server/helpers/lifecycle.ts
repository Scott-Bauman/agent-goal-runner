import { afterEach, beforeEach } from "vitest";

import { closeTestServer } from "./fastify";
import { resetChokidarMocks } from "./chokidarMock";
import { resetRepositoryBrowseMock } from "./repositoryBrowse";
import { cleanupTempPaths } from "./tempRepository";

export function useServerTestLifecycle(): void {
  beforeEach(() => {
    resetChokidarMocks();
    resetRepositoryBrowseMock();
  });

  afterEach(async () => {
    await closeTestServer();
    await cleanupTempPaths();
  });
}
