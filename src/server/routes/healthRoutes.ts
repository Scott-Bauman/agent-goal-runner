import type { FastifyInstance } from "fastify";

export function registerHealthRoutes(server: FastifyInstance): void {
  server.get("/", async () => ({
    name: "codex-goal-runner",
    status: "ok",
  }));

  server.get("/health", async () => ({
    status: "ok",
  }));
}
