import type { FastifyInstance } from "fastify";

import {
  createDefaultGoalMarkdown,
  getGoalFilePath,
  isGoalPathRestrictionError,
  readGoalMarkdown,
} from "../goal/goalFile.js";
import { isNodeErrorCode } from "../shared/nodeErrors.js";
import type { ServerRuntimeContext } from "../shared/runtime.js";
import {
  emptyRequestSchema,
  formatZodIssues,
  validationError,
} from "../shared/validation.js";

export function registerGoalRoutes(
  server: FastifyInstance,
  context: ServerRuntimeContext,
): void {
  server.get("/api/goal", async (request, reply) => {
    const parsedQuery = emptyRequestSchema.safeParse(request.query);

    if (!parsedQuery.success) {
      return reply
        .code(400)
        .send(
          validationError("Invalid goal request.", formatZodIssues(parsedQuery.error)),
        );
    }

    if (!context.runtimeState.selectedRepositoryPath) {
      return reply.code(409).send({
        error: "No repository selected.",
      });
    }

    const goalFilePath = getGoalFilePath(context.runtimeState.selectedRepositoryPath);
    let markdown: string;

    try {
      markdown = await readGoalMarkdown(context.runtimeState.selectedRepositoryPath);
    } catch (error) {
      if (isNodeErrorCode(error, "ENOENT")) {
        return reply.code(404).send({
          error: "goal.md does not exist in the selected repository.",
          code: "GOAL_MISSING",
          repositoryPath: context.runtimeState.selectedRepositoryPath,
          goalPath: goalFilePath,
          exists: false,
        });
      }

      if (isGoalPathRestrictionError(error)) {
        return reply.code(400).send({
          error: error.message,
          code: "GOAL_PATH_RESTRICTED",
          repositoryPath: context.runtimeState.selectedRepositoryPath,
          goalPath: goalFilePath,
        });
      }

      throw error;
    }

    return {
      repositoryPath: context.runtimeState.selectedRepositoryPath,
      goalPath: goalFilePath,
      markdown,
    };
  });

  server.post("/api/goal", async (request, reply) => {
    const parsedQuery = emptyRequestSchema.safeParse(request.query);
    const parsedBody = emptyRequestSchema.safeParse(request.body ?? {});

    if (!parsedQuery.success || !parsedBody.success) {
      return reply.code(400).send(
        validationError("Invalid goal creation request.", [
          ...(!parsedQuery.success ? formatZodIssues(parsedQuery.error) : []),
          ...(!parsedBody.success ? formatZodIssues(parsedBody.error) : []),
        ]),
      );
    }

    if (!context.runtimeState.selectedRepositoryPath) {
      return reply.code(409).send({
        error: "No repository selected.",
      });
    }

    const goalFilePath = getGoalFilePath(context.runtimeState.selectedRepositoryPath);
    let createdGoal;

    try {
      createdGoal = await createDefaultGoalMarkdown(
        context.runtimeState.selectedRepositoryPath,
      );
    } catch (error) {
      if (isNodeErrorCode(error, "EEXIST")) {
        return reply.code(409).send({
          error: "goal.md already exists in the selected repository.",
          code: "GOAL_EXISTS",
          repositoryPath: context.runtimeState.selectedRepositoryPath,
          goalPath: goalFilePath,
          exists: true,
        });
      }

      if (isGoalPathRestrictionError(error)) {
        return reply.code(400).send({
          error: error.message,
          code: "GOAL_PATH_RESTRICTED",
          repositoryPath: context.runtimeState.selectedRepositoryPath,
          goalPath: goalFilePath,
        });
      }

      throw error;
    }

    return reply.code(201).send({
      repositoryPath: context.runtimeState.selectedRepositoryPath,
      goalPath: goalFilePath,
      markdown: createdGoal.markdown,
      exists: true,
    });
  });
}
