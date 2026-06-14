import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  createGoalMarkdown,
  getGoalFilePath,
  isGoalRevisionMismatchError,
  isGoalPathRestrictionError,
  readGoalMarkdownWithRevision,
  updateGoalMarkdown,
} from "../goal/goalFile.js";
import { isNodeErrorCode } from "../shared/nodeErrors.js";
import type { ServerRuntimeContext } from "../shared/runtime.js";
import {
  emptyRequestSchema,
  formatParsedRequestIssues,
  formatZodIssues,
  validationError,
} from "../shared/validation.js";

const goalCreateSchema = z
  .object({
    markdown: z
      .string({
        invalid_type_error: "Goal markdown must be a string.",
      })
      .optional(),
  })
  .strict();

const goalUpdateSchema = z
  .object({
    expectedRevision: z
      .string({
        invalid_type_error: "Expected revision must be a string.",
        required_error: "Expected revision is required.",
      })
      .min(1, "Expected revision is required."),
    markdown: z.string({
      invalid_type_error: "Goal markdown must be a string.",
      required_error: "Goal markdown is required.",
    }),
  })
  .strict();

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
    let goalFile;

    try {
      goalFile = await readGoalMarkdownWithRevision(
        context.runtimeState.selectedRepositoryPath,
      );
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
      markdown: goalFile.markdown,
      revision: goalFile.revision,
    };
  });

  server.post("/api/goal", async (request, reply) => {
    const parsedQuery = emptyRequestSchema.safeParse(request.query);
    const parsedBody = goalCreateSchema.safeParse(request.body ?? {});

    if (!parsedQuery.success || !parsedBody.success) {
      return reply.code(400).send(
        validationError(
          "Invalid goal creation request.",
          formatParsedRequestIssues(parsedQuery, parsedBody),
        ),
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
      createdGoal = await createGoalMarkdown(
        context.runtimeState.selectedRepositoryPath,
        parsedBody.data.markdown,
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
      revision: createdGoal.revision,
      exists: true,
    });
  });

  server.put("/api/goal", async (request, reply) => {
    const parsedQuery = emptyRequestSchema.safeParse(request.query);
    const parsedBody = goalUpdateSchema.safeParse(request.body);

    if (!parsedQuery.success || !parsedBody.success) {
      return reply.code(400).send(
        validationError(
          "Invalid goal update request.",
          formatParsedRequestIssues(parsedQuery, parsedBody),
        ),
      );
    }

    if (!context.runtimeState.selectedRepositoryPath) {
      return reply.code(409).send({
        error: "No repository selected.",
      });
    }

    const goalFilePath = getGoalFilePath(context.runtimeState.selectedRepositoryPath);
    let updatedGoal;

    try {
      updatedGoal = await updateGoalMarkdown(
        context.runtimeState.selectedRepositoryPath,
        parsedBody.data.markdown,
        parsedBody.data.expectedRevision,
      );
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

      if (isGoalRevisionMismatchError(error)) {
        return reply.code(409).send({
          error: error.message,
          code: "GOAL_REVISION_MISMATCH",
          repositoryPath: context.runtimeState.selectedRepositoryPath,
          goalPath: goalFilePath,
          expectedRevision: error.expectedRevision,
          actualRevision: error.actualRevision,
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
      markdown: updatedGoal.markdown,
      revision: updatedGoal.revision,
      exists: true,
    };
  });
}
