import path from "node:path";
import { writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

import { readGoalMarkdown } from "../../../src/server/goal/goalFile";
import {
  createReviewPrompt,
  createReviewPromptPrefix,
  DEFAULT_REVIEW_RUN_OPTIONS,
  RunController,
} from "../../../src/server/runner/runController";
import { parseVerificationCommand } from "../../../src/server/runner/verificationCommand";
import type { RuntimeState } from "../../../src/server/shared/runtime";
import { createInitialStreamState, SseHub } from "../../../src/server/sse/sseHub";
import { createMockRunProcess } from "../helpers/process";
import { createRepositoryPath } from "../helpers/tempRepository";
import { useServerTestLifecycle } from "../helpers/lifecycle";

useServerTestLifecycle();

describe("run controller orchestration", () => {
  it("builds a review prompt that reflects the configured commit interval", () => {
    expect(createReviewPromptPrefix(3)).toBe(
      "Review the last 3 commits for bugs, regressions, and missed requirements. Fix any issues you find, then report what you changed.",
    );
    expect(
      createReviewPrompt({
        enabled: true,
        intervalCommits: 3,
        prompt: "Check the implementation carefully.",
        model: null,
        reasoningEffort: null,
      }),
    ).toBe(
      "Review the last 3 commits for bugs, regressions, and missed requirements. Fix any issues you find, then report what you changed.\n\nCheck the implementation carefully.",
    );
  });

  it("does not duplicate the dynamic review prompt prefix", () => {
    expect(
      createReviewPrompt({
        enabled: true,
        intervalCommits: 3,
        prompt:
          "Review the last 3 commits for bugs, regressions, and missed requirements. Fix any issues you find, then report what you changed.",
        model: null,
        reasoningEffort: null,
      }),
    ).toBe(
      "Review the last 3 commits for bugs, regressions, and missed requirements. Fix any issues you find, then report what you changed.",
    );
  });

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
      verificationCommandsToRun: [],
      autoCommit: false,
      model: "gpt-5.4",
      reasoningEffort: "medium",
      review: DEFAULT_REVIEW_RUN_OPTIONS,
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
    expect(spawnProcess.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining(["--model", "gpt-5.4", "-c", "model_reasoning_effort=medium"]),
    );
    expect(spawnProcess.mock.calls[1]?.[1]).toEqual(
      expect.arrayContaining(["--model", "gpt-5.4", "-c", "model_reasoning_effort=medium"]),
    );
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
      verificationCommandsToRun: [],
      autoCommit: false,
      model: null,
      reasoningEffort: null,
      review: DEFAULT_REVIEW_RUN_OPTIONS,
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

  it("does not run review when auto-commit skips a no-change normal run", async () => {
    const repositoryPath = await createRepositoryPath();
    const goalMarkdown = "# Goal\n\n- [ ] Next\n";
    await writeFile(path.join(repositoryPath, "goal.md"), goalMarkdown);
    const runProcess = createMockRunProcess(321);
    const gitAddProcess = createMockRunProcess(654);
    const gitStatusProcess = createMockRunProcess(987);
    const spawnProcess = vi
      .fn()
      .mockReturnValueOnce(runProcess)
      .mockReturnValueOnce(gitAddProcess)
      .mockReturnValueOnce(gitStatusProcess);
    const runtimeState: RuntimeState = {
      selectedRepositoryPath: repositoryPath,
      stream: createInitialStreamState(),
    };
    const controller = new RunController(runtimeState, new SseHub(), spawnProcess);

    controller.start({
      repositoryPath,
      prompt: "Use goal.md as the source of truth.",
      runCount: 1,
      verificationCommandsToRun: [],
      autoCommit: true,
      model: null,
      reasoningEffort: null,
      review: {
        enabled: true,
        intervalCommits: 1,
        prompt: "Review recent commits.",
        model: null,
        reasoningEffort: null,
      },
    });
    runProcess.emit("close", 0, null);
    await vi.waitFor(() => {
      expect(spawnProcess).toHaveBeenCalledTimes(2);
    });
    gitAddProcess.emit("close", 0, null);
    await vi.waitFor(() => {
      expect(spawnProcess).toHaveBeenCalledTimes(3);
    });
    gitStatusProcess.emit("close", 0, null);

    await vi.waitFor(() => {
      expect(runtimeState.stream.runLoop.latestSummary).toEqual({
        status: "complete",
        message: `Completed Codex run 1 of 1 and refreshed goal.md (${goalMarkdown.length} characters).`,
      });
    });
    expect(spawnProcess).toHaveBeenCalledTimes(3);
  });

  it("runs review after the configured number of successful normal commits", async () => {
    const repositoryPath = await createRepositoryPath();
    await writeFile(path.join(repositoryPath, "goal.md"), "# Goal\n\n- [ ] Next\n");
    const parsedVerification = parseVerificationCommand("npm test");

    if (!parsedVerification.success || !parsedVerification.parsed) {
      throw new Error("Expected verification command to parse.");
    }

    const firstRunProcess = createMockRunProcess(101);
    const firstVerificationProcess = createMockRunProcess(102);
    const firstGitAddProcess = createMockRunProcess(103);
    const firstGitStatusProcess = createMockRunProcess(104);
    const firstGitCommitProcess = createMockRunProcess(105);
    const secondRunProcess = createMockRunProcess(201);
    const secondVerificationProcess = createMockRunProcess(202);
    const secondGitAddProcess = createMockRunProcess(203);
    const secondGitStatusProcess = createMockRunProcess(204);
    const secondGitCommitProcess = createMockRunProcess(205);
    const reviewRunProcess = createMockRunProcess(301);
    const reviewVerificationProcess = createMockRunProcess(302);
    const reviewGitAddProcess = createMockRunProcess(303);
    const reviewGitStatusProcess = createMockRunProcess(304);
    const reviewGitCommitProcess = createMockRunProcess(305);
    const thirdRunProcess = createMockRunProcess(401);
    const spawnProcess = vi
      .fn()
      .mockReturnValueOnce(firstRunProcess)
      .mockReturnValueOnce(firstVerificationProcess)
      .mockReturnValueOnce(firstGitAddProcess)
      .mockReturnValueOnce(firstGitStatusProcess)
      .mockReturnValueOnce(firstGitCommitProcess)
      .mockReturnValueOnce(secondRunProcess)
      .mockReturnValueOnce(secondVerificationProcess)
      .mockReturnValueOnce(secondGitAddProcess)
      .mockReturnValueOnce(secondGitStatusProcess)
      .mockReturnValueOnce(secondGitCommitProcess)
      .mockReturnValueOnce(reviewRunProcess)
      .mockReturnValueOnce(reviewVerificationProcess)
      .mockReturnValueOnce(reviewGitAddProcess)
      .mockReturnValueOnce(reviewGitStatusProcess)
      .mockReturnValueOnce(reviewGitCommitProcess)
      .mockReturnValueOnce(thirdRunProcess);
    const runtimeState: RuntimeState = {
      selectedRepositoryPath: repositoryPath,
      stream: createInitialStreamState(),
    };
    const controller = new RunController(runtimeState, new SseHub(), spawnProcess);

    controller.start({
      repositoryPath,
      prompt: "Use goal.md as the source of truth.",
      runCount: 3,
      verificationCommandsToRun: [parsedVerification.parsed],
      autoCommit: true,
      model: "gpt-5.4",
      reasoningEffort: "medium",
      review: {
        enabled: true,
        intervalCommits: 2,
        prompt: "Review recent commits.",
        model: "gpt-5.4-nano",
        reasoningEffort: "low",
      },
    });

    firstRunProcess.emit("close", 0, null);
    await vi.waitFor(() => {
      expect(spawnProcess).toHaveBeenCalledTimes(2);
    });
    firstVerificationProcess.emit("close", 0, null);
    await vi.waitFor(() => {
      expect(spawnProcess).toHaveBeenCalledTimes(3);
    });
    firstGitAddProcess.emit("close", 0, null);
    await vi.waitFor(() => {
      expect(spawnProcess).toHaveBeenCalledTimes(4);
    });
    firstGitStatusProcess.stdout.write(" M goal.md\n");
    firstGitStatusProcess.emit("close", 0, null);
    await vi.waitFor(() => {
      expect(spawnProcess).toHaveBeenCalledTimes(5);
    });
    firstGitCommitProcess.emit("close", 0, null);
    await vi.waitFor(() => {
      expect(spawnProcess).toHaveBeenCalledTimes(6);
    });

    secondRunProcess.emit("close", 0, null);
    await vi.waitFor(() => {
      expect(spawnProcess).toHaveBeenCalledTimes(7);
    });
    secondVerificationProcess.emit("close", 0, null);
    await vi.waitFor(() => {
      expect(spawnProcess).toHaveBeenCalledTimes(8);
    });
    secondGitAddProcess.emit("close", 0, null);
    await vi.waitFor(() => {
      expect(spawnProcess).toHaveBeenCalledTimes(9);
    });
    secondGitStatusProcess.stdout.write(" M goal.md\n");
    secondGitStatusProcess.emit("close", 0, null);
    await vi.waitFor(() => {
      expect(spawnProcess).toHaveBeenCalledTimes(10);
    });
    secondGitCommitProcess.emit("close", 0, null);
    await vi.waitFor(() => {
      expect(spawnProcess).toHaveBeenCalledTimes(11);
    });

    const reviewArgs = spawnProcess.mock.calls[10]?.[1] as string[];
    expect(reviewArgs).toEqual(
      expect.arrayContaining([
        "--model",
        "gpt-5.4-nano",
        "-c",
        "model_reasoning_effort=low",
        "Review the last 2 commits for bugs, regressions, and missed requirements. Fix any issues you find, then report what you changed.\n\nReview recent commits.",
      ]),
    );

    reviewRunProcess.emit("close", 0, null);
    await vi.waitFor(() => {
      expect(spawnProcess).toHaveBeenCalledTimes(12);
    });
    expect(spawnProcess).toHaveBeenNthCalledWith(12, "npm", ["test"], {
      cwd: repositoryPath,
      windowsHide: true,
    });

    reviewVerificationProcess.emit("close", 0, null);
    await vi.waitFor(() => {
      expect(spawnProcess).toHaveBeenCalledTimes(13);
    });
    reviewGitAddProcess.emit("close", 0, null);
    await vi.waitFor(() => {
      expect(spawnProcess).toHaveBeenCalledTimes(14);
    });
    reviewGitStatusProcess.stdout.write(" M goal.md\n");
    reviewGitStatusProcess.emit("close", 0, null);
    await vi.waitFor(() => {
      expect(spawnProcess).toHaveBeenCalledTimes(15);
    });
    expect(spawnProcess).toHaveBeenNthCalledWith(
      15,
      "git",
      [
        "commit",
        "-m",
        "codex-goal-runner: apply review after Codex run 2 of 3",
        "-m",
        "Generated by codex-goal-runner after review and optional verification succeeded.",
      ],
      {
        cwd: repositoryPath,
        windowsHide: true,
      },
    );

    reviewGitCommitProcess.emit("close", 0, null);
    await vi.waitFor(() => {
      expect(spawnProcess).toHaveBeenCalledTimes(16);
    });
    expect(runtimeState.stream.runLoop).toMatchObject({
      status: "running",
      activeProcessId: 401,
      progress: {
        currentRun: 3,
        totalRuns: 3,
      },
    });
  });
});
