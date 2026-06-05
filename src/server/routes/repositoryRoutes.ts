import type { FastifyInstance } from "fastify";

import {
  repositorySelectionSchema,
  validateRepositoryPath,
} from "../repository/repositorySelection.js";
import type { ServerRuntimeContext } from "../shared/runtime.js";
import { formatZodIssues, validationError } from "../shared/validation.js";

export function registerRepositoryRoutes(
  server: FastifyInstance,
  context: ServerRuntimeContext,
): void {
  server.get("/api/repository/selection", async () => ({
    repositoryPath: context.runtimeState.selectedRepositoryPath,
  }));

  server.post("/api/repository/select", async (request, reply) => {
    const parsedBody = repositorySelectionSchema.safeParse(request.body);

    if (!parsedBody.success) {
      return reply
        .code(400)
        .send(
          validationError(
            "Invalid repository selection request.",
            formatZodIssues(parsedBody.error),
          ),
        );
    }

    const repositoryPathIssue = await validateRepositoryPath(parsedBody.data.path);

    if (repositoryPathIssue) {
      return reply.code(400).send(
        validationError("Invalid repository selection request.", [
          {
            path: "path",
            message: repositoryPathIssue,
          },
        ]),
      );
    }

    context.runtimeState.selectedRepositoryPath = parsedBody.data.path;
    await context.goalWatcher.replace(context.runtimeState.selectedRepositoryPath);
    context.sseHub.broadcast("status", {
      status: context.runtimeState.stream.runLoop.status,
      selectedRepositoryPath: context.runtimeState.selectedRepositoryPath,
    });

    return {
      repositoryPath: context.runtimeState.selectedRepositoryPath,
    };
  });
}
