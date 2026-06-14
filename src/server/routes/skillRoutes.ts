import type { FastifyInstance } from "fastify";

import {
  copyBundledSkillToRepository,
  copyBundledSkillToUserGlobal,
  getSkillInstallStatus,
  GOAL_RUNNER_SKILL_NAME,
} from "../skills/skillInstallation.js";
import { ACTIVE_RUN_STATUSES } from "../runner/statuses.js";
import type { ServerRuntimeContext } from "../shared/runtime.js";
import {
  emptyRequestSchema,
  formatEmptyRequestIssues,
  formatZodIssues,
  validationError,
} from "../shared/validation.js";
import { getRepositoryPathForInactiveRun } from "./routeGuards.js";

export function registerSkillRoutes(
  server: FastifyInstance,
  context: ServerRuntimeContext,
): void {
  server.get("/api/skills/goal-runner-framework", async (request, reply) => {
    const parsedQuery = emptyRequestSchema.safeParse(request.query);

    if (!parsedQuery.success) {
      return reply
        .code(400)
        .send(
          validationError(
            "Invalid skill status request.",
            formatZodIssues(parsedQuery.error),
          ),
        );
    }

    return getGoalRunnerSkillStatus(context);
  });

  server.post(
    "/api/skills/goal-runner-framework/install/repo",
    async (request, reply) => {
      const requestIssues = formatEmptyRequestIssues(request.query, request.body);

      if (requestIssues.length > 0) {
        return reply.code(400).send(
          validationError("Invalid repo skill install request.", requestIssues),
        );
      }

      const repositoryPath = getRepositoryPathForInactiveRun(
        context,
        reply,
        "Cannot install repo-local skill while a run is active.",
      );

      if (!repositoryPath) {
        return;
      }

      try {
        return await copyBundledSkillToRepository(
          GOAL_RUNNER_SKILL_NAME,
          repositoryPath,
          {
            appRootPath: context.skillAppRootPath,
            userHomePath: context.skillUserHomePath,
          },
        );
      } catch (error) {
        return reply.code(500).send({
          error: formatSkillInstallError(error, "Failed to install repo-local skill."),
        });
      }
    },
  );

  server.post(
    "/api/skills/goal-runner-framework/install/global",
    async (request, reply) => {
      const requestIssues = formatEmptyRequestIssues(request.query, request.body);

      if (requestIssues.length > 0) {
        return reply.code(400).send(
          validationError("Invalid global skill install request.", requestIssues),
        );
      }

      if (ACTIVE_RUN_STATUSES.has(context.runtimeState.stream.runLoop.status)) {
        return reply.code(409).send({
          error: "Cannot install global skill while a run is active.",
        });
      }

      try {
        return await copyBundledSkillToUserGlobal(
          GOAL_RUNNER_SKILL_NAME,
          context.runtimeState.selectedRepositoryPath,
          {
            appRootPath: context.skillAppRootPath,
            userHomePath: context.skillUserHomePath,
          },
        );
      } catch (error) {
        return reply.code(500).send({
          error: formatSkillInstallError(error, "Failed to install global skill."),
        });
      }
    },
  );
}

function getGoalRunnerSkillStatus(context: ServerRuntimeContext) {
  return getSkillInstallStatus(GOAL_RUNNER_SKILL_NAME, {
    appRootPath: context.skillAppRootPath,
    repositoryPath: context.runtimeState.selectedRepositoryPath,
    userHomePath: context.skillUserHomePath,
  });
}

function formatSkillInstallError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
