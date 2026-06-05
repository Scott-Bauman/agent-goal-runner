import type { GoalWatcherController } from "../goal/goalWatcher.js";
import type { RunController } from "../runner/runController.js";
import type { RuntimeStreamState } from "../sse/types.js";
import type { SseHub } from "../sse/sseHub.js";

export type RuntimeState = {
  selectedRepositoryPath: string | null;
  stream: RuntimeStreamState;
};

export type ServerRuntimeContext = {
  runtimeState: RuntimeState;
  sseHub: SseHub;
  goalWatcher: GoalWatcherController;
  runController: RunController;
};
