import type { FastifyInstance } from "fastify";

export type RegisterHealthRoutesOptions = {
  includeRootStatus?: boolean;
};

export function registerHealthRoutes(
  server: FastifyInstance,
  options: RegisterHealthRoutesOptions = {},
): void {
  if (options.includeRootStatus ?? true) {
    server.get("/", async () => ({
      name: "codex-goal-runner",
      status: "ok",
    }));
  }

  server.get("/health", async () => ({
    status: "ok",
  }));
}
