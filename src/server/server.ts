import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { spawn } from "node:child_process";

import { GoalWatcherController } from "./goal/goalWatcher.js";
import { openFolderDialog } from "./repository/folderDialog.js";
import type { FolderDialogResult } from "./repository/folderDialog.js";
import { registerEventsRoutes } from "./routes/eventsRoutes.js";
import { registerGoalRoutes } from "./routes/goalRoutes.js";
import { registerHealthRoutes } from "./routes/healthRoutes.js";
import { registerRepositoryRoutes } from "./routes/repositoryRoutes.js";
import { registerRunRoutes } from "./routes/runRoutes.js";
import { RunController } from "./runner/runController.js";
import type { ProcessSpawner } from "./shared/process.js";
import type { RuntimeState, ServerRuntimeContext } from "./shared/runtime.js";
import { createInitialStreamState, SseHub } from "./sse/sseHub.js";

export type BuildServerOptions = {
  openRepositoryFolderDialog?: () => Promise<FolderDialogResult>;
  spawnProcess?: ProcessSpawner;
};

export async function buildServer(
  options: BuildServerOptions = {},
): Promise<FastifyInstance> {
  const spawnProcess = options.spawnProcess ?? spawn;
  const server = Fastify({
    logger: true,
  });
  const runtimeState: RuntimeState = {
    selectedRepositoryPath: null,
    stream: createInitialStreamState(),
  };
  const sseHub = new SseHub();
  const goalWatcher = new GoalWatcherController(sseHub);
  const runController = new RunController(runtimeState, sseHub, spawnProcess);
  const context: ServerRuntimeContext = {
    runtimeState,
    sseHub,
    goalWatcher,
    runController,
    openRepositoryFolderDialog:
      options.openRepositoryFolderDialog ?? openFolderDialog,
  };

  await server.register(cors, {
    origin: true,
  });

  server.addHook("onClose", async () => {
    runController.dispose();
    await goalWatcher.stop();
  });

  registerHealthRoutes(server);
  registerRepositoryRoutes(server, context);
  registerEventsRoutes(server, context);
  registerGoalRoutes(server, context);
  registerRunRoutes(server, context);

  return server;
}
