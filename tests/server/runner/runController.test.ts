import path from "node:path";
import { writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

import { readGoalMarkdown } from "../../../src/server/goal/goalFile";
import { RunController } from "../../../src/server/runner/runController";
import type { RuntimeState } from "../../../src/server/shared/runtime";
import { createInitialStreamState, SseHub } from "../../../src/server/sse/sseHub";
import { createMockRunProcess } from "../helpers/process";
import { createRepositoryPath } from "../helpers/tempRepository";
import { useServerTestLifecycle } from "../helpers/lifecycle";

useServerTestLifecycle();

describe("run controller orchestration", () => {
  it("starts the next Codex run after a successful run with no stop marker", async () => {
    const repositoryPath = await createRepositoryPath();
    await writeFile(path.join(repositoryPath, "goal.md"), "# Goal\n\n- [ ] Next\n");
    const firstRunProcess = createMockRunProcess(321);
    const secondRunProcess = createMockRunProcess(654);
    const spawnProcess = vi
      .fn()
      .mockReturnValueOnce(firstRunProcess)
      .mockReturnValueOnce(secondRunProcess);
    const runtimeState: RuntimeState = {
      selectedRepositoryPath: repositoryPath,
      stream: createInitialStreamState(),
    };
    const controller = new RunController(runtimeState, new SseHub(), spawnProcess);

    controller.start({
      repositoryPath,
      prompt: "Use goal.md as the source of truth.",
      runCount: 2,
      verificationCommandToRun: null,
      autoCommit: false,
    });
    firstRunProcess.emit("close", 0, null);

    await vi.waitFor(() => {
      expect(spawnProcess).toHaveBeenCalledTimes(2);
    });
    expect(runtimeState.stream.runLoop).toMatchObject({
      status: "running",
      activeProcessId: 654,
      progress: {
        currentRun: 2,
        totalRuns: 2,
      },
      latestSummary: {
        status: "running",
        message: "Started Codex run 2 of 2.",
      },
    });
  });

  it("blocks the run loop when the refreshed goal contains GOAL_BLOCKED", async () => {
    const repositoryPath = await createRepositoryPath();
    await writeFile(path.join(repositoryPath, "goal.md"), "GOAL_BLOCKED\n");
    const runProcess = createMockRunProcess();
    const runtimeState: RuntimeState = {
      selectedRepositoryPath: repositoryPath,
      stream: createInitialStreamState(),
    };
    const controller = new RunController(runtimeState, new SseHub(), vi.fn(() => runProcess));

    controller.start({
      repositoryPath,
      prompt: "Use goal.md as the source of truth.",
      runCount: 3,
      verificationCommandToRun: null,
      autoCommit: false,
    });
    runProcess.emit("close", 0, null);

    expect(await readGoalMarkdown(repositoryPath)).toContain("GOAL_BLOCKED");
    await vi.waitFor(() => {
      expect(runtimeState.stream.runLoop.latestSummary).toEqual({
        status: "blocked",
        message:
          "Stopped after Codex run 1 of 3 because refreshed goal.md contains GOAL_BLOCKED.",
      });
    });
  });
});
