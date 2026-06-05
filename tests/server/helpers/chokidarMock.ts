import { vi } from "vitest";

export type GoalWatchOptions = {
  ignored: (watchedPath: string, stats?: { isFile: () => boolean }) => boolean;
  ignoreInitial: boolean;
};

const chokidarMockState = vi.hoisted(() => {
  const close = vi.fn(() => Promise.resolve());
  const watcherInstances: Array<{
    handlers: Map<string, Array<(changedPath: string) => void>>;
  }> = [];

  return {
    close,
    watcherInstances,
    watch: vi.fn((paths: unknown, options?: GoalWatchOptions) => {
      void paths;
      void options;

      const handlers = new Map<string, Array<(changedPath: string) => void>>();
      const watcher = {
        close,
        on: vi.fn((eventName: string, handler: (changedPath: string) => void) => {
          handlers.set(eventName, [...(handlers.get(eventName) ?? []), handler]);
          return watcher;
        }),
      };

      watcherInstances.push({
        handlers,
      });

      return watcher;
    }),
  };
});

vi.mock("chokidar", () => ({
  watch: chokidarMockState.watch,
}));

export const chokidarMocks = chokidarMockState;

export function resetChokidarMocks(): void {
  chokidarMocks.close.mockClear();
  chokidarMocks.watch.mockClear();
  chokidarMocks.watcherInstances.splice(0);
}

export function emitLatestGoalWatcherEvent(
  eventName: string,
  changedPath: string,
): void {
  const latestWatcher = chokidarMocks.watcherInstances.at(-1);

  if (!latestWatcher) {
    throw new Error("No goal watcher has been created.");
  }

  for (const handler of latestWatcher.handlers.get(eventName) ?? []) {
    handler(changedPath);
  }
}

export function getLatestWatchOptions(): GoalWatchOptions {
  const latestWatchCall = chokidarMocks.watch.mock.calls.at(-1);

  if (!latestWatchCall) {
    throw new Error("No goal watcher has been created.");
  }

  const options = latestWatchCall[1];

  if (!options) {
    throw new Error("Latest goal watcher was created without watch options.");
  }

  return options;
}
