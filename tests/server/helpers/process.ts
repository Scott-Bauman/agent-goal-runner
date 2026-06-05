import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { vi } from "vitest";

export type MockRunProcess = ChildProcessWithoutNullStreams & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
};

export function createMockRunProcess(pid = 321): MockRunProcess {
  const stdin = new PassThrough();

  return Object.assign(new EventEmitter(), {
    pid,
    stdin,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
  }) as unknown as MockRunProcess;
}
