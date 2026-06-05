import { watch, type FSWatcher } from "chokidar";
import path from "node:path";

import { getGoalFilePath } from "./goalFile.js";
import type { SseHub } from "../sse/sseHub.js";

export class GoalWatcherController {
  private goalWatcher: FSWatcher | null = null;
  private watchedGoalPath: string | null = null;

  constructor(private readonly sseHub: SseHub) {}

  async stop(): Promise<void> {
    await this.goalWatcher?.close();
    this.goalWatcher = null;
    this.watchedGoalPath = null;
  }

  async replace(repositoryPath: string): Promise<void> {
    const goalFilePath = getGoalFilePath(repositoryPath);

    if (this.goalWatcher && this.watchedGoalPath === goalFilePath) {
      return;
    }

    await this.stop();

    this.goalWatcher = watch(goalFilePath, {
      ignoreInitial: true,
      ignored: (watchedPath, stats) =>
        Boolean(stats?.isFile() && path.resolve(watchedPath) !== goalFilePath),
    });

    const broadcastGoalChanged = (exists: boolean): void => {
      this.sseHub.broadcast("goalChanged", {
        repositoryPath,
        goalPath: goalFilePath,
        exists,
      });
    };

    const handleGoalWatcherEvent = (changedPath: string, exists: boolean): void => {
      if (path.resolve(changedPath) !== goalFilePath) {
        return;
      }

      broadcastGoalChanged(exists);
    };

    this.goalWatcher.on("add", (changedPath) => {
      handleGoalWatcherEvent(changedPath, true);
    });
    this.goalWatcher.on("change", (changedPath) => {
      handleGoalWatcherEvent(changedPath, true);
    });
    this.goalWatcher.on("unlink", (changedPath) => {
      handleGoalWatcherEvent(changedPath, false);
    });
    this.watchedGoalPath = goalFilePath;
  }
}
