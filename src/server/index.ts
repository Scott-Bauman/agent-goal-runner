import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import path from "node:path";
import { z } from "zod";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4317;

const repositorySelectionSchema = z
  .object({
    path: z
      .string()
      .trim()
      .min(1, "Path is required.")
      .refine((value) => path.isAbsolute(value), {
        message: "Path must be an absolute local filesystem path.",
      })
      .transform((value) => path.normalize(value)),
  })
  .strict();

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

  server.post("/api/repository/select", async (request, reply) => {
    const parsedBody = repositorySelectionSchema.safeParse(request.body);

    if (!parsedBody.success) {
      return reply.code(400).send({
        error: "Invalid repository selection request.",
        issues: parsedBody.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    return {
      repositoryPath: parsedBody.data.path,
    };
  });

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
