import type { FastifyInstance } from "fastify";
import path from "node:path";
import { z } from "zod";

import {
  createRepositoryBranch,
  getGitErrorMessage,
  getRepositoryBranches,
  switchRepositoryBranch,
  validateRepositoryBranchName,
} from "../repository/gitBranches.js";
import {
  FolderDialogCommandError,
  FolderDialogUnsupportedError,
} from "../repository/folderDialog.js";
import {
  validateRepositoryPath,
} from "../repository/repositorySelection.js";
import { ACTIVE_RUN_STATUSES } from "../runner/statuses.js";
import type { ServerRuntimeContext } from "../shared/runtime.js";
import {
  formatZodIssues,
  validationError,
} from "../shared/validation.js";

const branchSwitchSchema = z
  .object({
    branch: z
      .string({
        invalid_type_error: "Branch must be a string.",
        required_error: "Branch is required.",
      })
      .trim()
      .min(1, "Branch is required."),
  })
  .strict();

const branchCreateSchema = z
  .object({
    name: z
      .string({
        invalid_type_error: "Branch name must be a string.",
        required_error: "Branch name is required.",
      })
      .trim()
      .min(1, "Branch name is required."),
  })
  .strict();

export function registerRepositoryRoutes(
  server: FastifyInstance,
  context: ServerRuntimeContext,
): void {
  server.get("/api/repository/selection", async () => ({
    repositoryPath: context.runtimeState.selectedRepositoryPath,
  }));

  server.get("/api/repository/branches", async (_request, reply) => {
    if (!context.runtimeState.selectedRepositoryPath) {
      return reply.code(409).send({
        error: "No repository selected.",
      });
    }

    try {
      return await getRepositoryBranches(
        context.spawnProcess,
        context.runtimeState.selectedRepositoryPath,
      );
    } catch (error) {
      return reply.code(500).send({
        error: getGitErrorMessage(error, "Failed to load repository branches."),
      });
    }
  });

  server.post("/api/repository/branches/switch", async (request, reply) => {
    const parsedBody = branchSwitchSchema.safeParse(request.body);

    if (!parsedBody.success) {
      return reply
        .code(400)
        .send(
          validationError(
            "Invalid branch switch request.",
            formatZodIssues(parsedBody.error),
          ),
        );
    }

    if (!context.runtimeState.selectedRepositoryPath) {
      return reply.code(409).send({
        error: "No repository selected.",
      });
    }

    if (ACTIVE_RUN_STATUSES.has(context.runtimeState.stream.runLoop.status)) {
      return reply.code(409).send({
        error: "Cannot switch branches while a run is active.",
      });
    }

    const repositoryPath = context.runtimeState.selectedRepositoryPath;

    try {
      const branches = await getRepositoryBranches(
        context.spawnProcess,
        repositoryPath,
      );

      if (!branches.branches.includes(parsedBody.data.branch)) {
        return reply.code(400).send(
          validationError("Invalid branch switch request.", [
            {
              path: "branch",
              message: "Branch must be an existing local branch.",
            },
          ]),
        );
      }

      return await switchRepositoryBranch(
        context.spawnProcess,
        repositoryPath,
        parsedBody.data.branch,
      );
    } catch (error) {
      return reply.code(409).send({
        error: getGitErrorMessage(error, "Failed to switch branches."),
      });
    }
  });

  server.post("/api/repository/branches", async (request, reply) => {
    const parsedBody = branchCreateSchema.safeParse(request.body);

    if (!parsedBody.success) {
      return reply
        .code(400)
        .send(
          validationError(
            "Invalid branch creation request.",
            formatZodIssues(parsedBody.error),
          ),
        );
    }

    if (!context.runtimeState.selectedRepositoryPath) {
      return reply.code(409).send({
        error: "No repository selected.",
      });
    }

    if (ACTIVE_RUN_STATUSES.has(context.runtimeState.stream.runLoop.status)) {
      return reply.code(409).send({
        error: "Cannot create branches while a run is active.",
      });
    }

    const repositoryPath = context.runtimeState.selectedRepositoryPath;

    try {
      await validateRepositoryBranchName(
        context.spawnProcess,
        repositoryPath,
        parsedBody.data.name,
      );
    } catch (error) {
      return reply.code(400).send(
        validationError("Invalid branch creation request.", [
          {
            path: "name",
            message: getGitErrorMessage(error, "Invalid branch name."),
          },
        ]),
      );
    }

    try {
      return await createRepositoryBranch(
        context.spawnProcess,
        repositoryPath,
        parsedBody.data.name,
      );
    } catch (error) {
      return reply.code(409).send({
        error: getGitErrorMessage(error, "Failed to create branch."),
      });
    }
  });

  server.post("/api/repository/browse", async (_request, reply) => {
    let dialogResult;

    try {
      dialogResult = await context.openRepositoryFolderDialog();
    } catch (error) {
      if (
        error instanceof FolderDialogUnsupportedError ||
        error instanceof FolderDialogCommandError
      ) {
        return reply.code(500).send({
          error: error.message,
        });
      }

      throw error;
    }

    if (dialogResult.cancelled) {
      return {
        repositoryPath: null,
        cancelled: true,
      };
    }

    const repositoryPath = path.normalize(dialogResult.path);
    const repositoryPathIssue = await validateRepositoryPath(repositoryPath);

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

    context.runtimeState.selectedRepositoryPath = repositoryPath;
    await context.goalWatcher.replace(context.runtimeState.selectedRepositoryPath);
    context.sseHub.broadcast("status", {
      status: context.runtimeState.stream.runLoop.status,
      selectedRepositoryPath: context.runtimeState.selectedRepositoryPath,
    });

    return {
      repositoryPath: context.runtimeState.selectedRepositoryPath,
      cancelled: false,
    };
  });
}
