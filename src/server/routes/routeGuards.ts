import type { FastifyReply } from "fastify";

import { ACTIVE_RUN_STATUSES } from "../runner/statuses.js";
import type { ServerRuntimeContext } from "../shared/runtime.js";

export function getRepositoryPathForInactiveRun(
  context: ServerRuntimeContext,
  reply: FastifyReply,
  activeRunError: string,
): string | null {
  const repositoryPath = context.runtimeState.selectedRepositoryPath;

  if (!repositoryPath) {
    void reply.code(409).send({
      error: "No repository selected.",
    });
    return null;
  }

  if (ACTIVE_RUN_STATUSES.has(context.runtimeState.stream.runLoop.status)) {
    void reply.code(409).send({
      error: activeRunError,
    });
    return null;
  }

  return repositoryPath;
}
