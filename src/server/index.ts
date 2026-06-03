import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4317;

export async function buildServer(): Promise<FastifyInstance> {
  const server = Fastify({
    logger: true,
  });

  await server.register(cors, {
    origin: true,
  });

  server.get("/", async () => ({
    name: "codex-goal-runner",
    status: "ok",
  }));

  server.get("/health", async () => ({
    status: "ok",
  }));

  return server;
}

async function startServer(): Promise<void> {
  const server = await buildServer();
  const host = process.env.HOST || DEFAULT_HOST;
  const port = Number.parseInt(process.env.PORT || "", 10) || DEFAULT_PORT;

  try {
    await server.listen({ host, port });
  } catch (error) {
    server.log.error(error);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void startServer();
}
