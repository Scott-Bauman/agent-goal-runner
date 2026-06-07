import type { FastifyInstance } from "fastify";
import path from "node:path";

import {
  FolderDialogCommandError,
  FolderDialogUnsupportedError,
} from "../repository/folderDialog.js";
import {
  validateRepositoryPath,
} from "../repository/repositorySelection.js";
import type { ServerRuntimeContext } from "../shared/runtime.js";
import { validationError } from "../shared/validation.js";

export function registerRepositoryRoutes(
  server: FastifyInstance,
  context: ServerRuntimeContext,
): void {
  server.get("/api/repository/selection", async () => ({
    repositoryPath: context.runtimeState.selectedRepositoryPath,
  }));

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
