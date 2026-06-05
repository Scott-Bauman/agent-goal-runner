import type { FastifyInstance } from "fastify";

import type { ServerRuntimeContext } from "../shared/runtime.js";
import {
  emptyRequestSchema,
  formatZodIssues,
  validationError,
} from "../shared/validation.js";
import { createSseSnapshot } from "../sse/sseHub.js";

export function registerEventsRoutes(
  server: FastifyInstance,
  context: ServerRuntimeContext,
): void {
  server.get("/api/events", async (request, reply) => {
    const parsedQuery = emptyRequestSchema.safeParse(request.query);

    if (!parsedQuery.success) {
      return reply
        .code(400)
        .send(
          validationError("Invalid events request.", formatZodIssues(parsedQuery.error)),
        );
    }

    reply.hijack();
    request.raw.socket.setTimeout(0);
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const client = context.sseHub.registerClient((chunk) => reply.raw.write(chunk));
    client.write(
      createSseSnapshot(
        context.runtimeState.stream,
        context.runtimeState.selectedRepositoryPath,
      ),
    );

    request.raw.on("close", () => {
      context.sseHub.unregisterClient(client.id);
    });

    return undefined;
  });
}
