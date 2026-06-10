import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildServer } from "../../src/server/server";
import { startServer } from "../../src/server/startServer";

vi.mock("../../src/server/server.js", () => ({
  buildServer: vi.fn(),
}));

const buildServerMock = vi.mocked(buildServer);
const originalHost = process.env.HOST;
const originalPort = process.env.PORT;
const originalExitCode = process.exitCode;

function createMockServer() {
  return {
    listen: vi.fn().mockResolvedValue(undefined),
    log: {
      error: vi.fn(),
    },
  };
}

describe("startServer", () => {
  beforeEach(() => {
    buildServerMock.mockReset();
    delete process.env.HOST;
    delete process.env.PORT;
    process.exitCode = undefined;
  });

  afterEach(() => {
    if (originalHost === undefined) {
      delete process.env.HOST;
    } else {
      process.env.HOST = originalHost;
    }

    if (originalPort === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = originalPort;
    }

    process.exitCode = originalExitCode;
  });

  it("listens on the default local host and port", async () => {
    const server = createMockServer();
    buildServerMock.mockResolvedValue(server as never);

    await startServer();

    expect(server.listen).toHaveBeenCalledWith({
      host: "127.0.0.1",
      port: 4317,
    });
  });

  it("honors HOST and PORT environment overrides", async () => {
    const server = createMockServer();
    process.env.HOST = "0.0.0.0";
    process.env.PORT = "4320";
    buildServerMock.mockResolvedValue(server as never);

    await startServer();

    expect(server.listen).toHaveBeenCalledWith({
      host: "0.0.0.0",
      port: 4320,
    });
  });

  it("logs listen failures and sets a failed process exit code", async () => {
    const error = new Error("port unavailable");
    const server = createMockServer();
    server.listen.mockRejectedValue(error);
    buildServerMock.mockResolvedValue(server as never);

    await startServer();

    expect(server.log.error).toHaveBeenCalledWith(error);
    expect(process.exitCode).toBe(1);
  });
});
