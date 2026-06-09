/* v8 ignore start -- Type-only module with no runtime behavior. */
import type {
  ChildProcessWithoutNullStreams,
  SpawnOptionsWithoutStdio,
} from "node:child_process";

export type ProcessSpawner = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams;

export type SpawnCommand = {
  command: string;
  args: string[];
};
