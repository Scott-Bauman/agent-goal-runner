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
        ...DEFAULT_REVIEW_RUN_OPTIONS,
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
        ...DEFAULT_REVIEW_RUN_OPTIONS,
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
      provider: "codex",
      prompt: "Use goal.md as the source of truth.",
      runCount: 2,
      verificationCommandsToRun: [],
      autoCommit: false,
      model: "gpt-5.4",
      reasoningEffort: "medium",
      claudeModel: null,
      piModel: null,
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
      provider: "codex",
      prompt: "Use goal.md as the source of truth.",
      runCount: 3,
      verificationCommandsToRun: [],
      autoCommit: false,
      model: null,
      reasoningEffort: null,
      claudeModel: null,
      piModel: null,
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

  it("streams Claude JSON events before close and records the parsed final assistant message", async () => {
    const repositoryPath = await createRepositoryPath();
    const goalMarkdown = "# Goal\n\n- [ ] Next\n";
    await writeFile(path.join(repositoryPath, "goal.md"), goalMarkdown);
    const runProcess = createMockRunProcess(321);
    const spawnProcess = vi.fn(() => runProcess);
    const runtimeState: RuntimeState = {
      selectedRepositoryPath: repositoryPath,
      stream: createInitialStreamState(),
    };
    const controller = new RunController(runtimeState, new SseHub(), spawnProcess);

    controller.start({
      repositoryPath,
      provider: "claude",
      prompt: "Use goal.md as the source of truth.",
      runCount: 1,
      verificationCommandsToRun: [],
      autoCommit: false,
      model: null,
      reasoningEffort: null,
      claudeModel: "sonnet",
      piModel: null,
      review: DEFAULT_REVIEW_RUN_OPTIONS,
    });

    expect(spawnProcess).toHaveBeenCalledWith(
      "claude",
      [
        "-p",
        "Use goal.md as the source of truth.",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--model",
        "sonnet",
      ],
      {
        cwd: repositoryPath,
        windowsHide: true,
      },
    );

    runProcess.stdout.write(
      `${JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "session-1",
        model: "claude-sonnet-4-5",
      })}\n`,
    );
    runProcess.stdout.write(
      `${JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "tool-1",
            name: "Bash",
            input: {
              command: "npm test",
            },
          },
        },
      })}\n`,
    );
    runProcess.stdout.write(
      `${JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "Claude final answer",
        usage: {
          input_tokens: 4,
          output_tokens: 6,
        },
      })}\n`,
    );

    expect(runtimeState.stream.runEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "agent_session_started",
          message: "Claude session started: session-1",
        }),
        expect.objectContaining({
          command: "npm test",
          kind: "command_started",
          message: "Command started: npm test",
        }),
        expect.objectContaining({
          kind: "final_assistant_message",
          message: "Claude final answer",
        }),
      ]),
    );
    expect(runtimeState.stream.runLoop.details).toMatchObject({
      lastAssistantMessage: "Claude final answer",
      model: "claude-sonnet-4-5",
      tokenCount: 10,
    });
    runProcess.emit("close", 0, null);

    await vi.waitFor(() => {
      expect(runtimeState.stream.runLoop.latestSummary).toEqual({
        status: "complete",
        message: `Completed Claude run 1 of 1 and refreshed goal.md (${goalMarkdown.length} characters).`,
      });
    });
    expect(runtimeState.stream.runLoop.details.lastAssistantMessage).toBe(
      "Claude final answer",
    );
    expect(
      runtimeState.stream.runEvents.filter(
        (event) =>
          event.kind === "final_assistant_message" &&
          event.message === "Claude final answer",
      ),
    ).toHaveLength(1);
  });

  it("streams Pi JSON events before close and records the parsed final assistant message", async () => {
    const repositoryPath = await createRepositoryPath();
    const goalMarkdown = "# Goal\n\n- [ ] Next\n";
    await writeFile(path.join(repositoryPath, "goal.md"), goalMarkdown);
    const runProcess = createMockRunProcess(321);
    const spawnProcess = vi.fn(() => runProcess);
    const runtimeState: RuntimeState = {
      selectedRepositoryPath: repositoryPath,
      stream: createInitialStreamState(),
    };
    const controller = new RunController(runtimeState, new SseHub(), spawnProcess);

    controller.start({
      repositoryPath,
      provider: "pi",
      prompt: "Use goal.md as the source of truth.",
      runCount: 1,
      verificationCommandsToRun: [],
      autoCommit: false,
      model: null,
      reasoningEffort: null,
      claudeModel: null,
      piModel: "local-llama",
      review: DEFAULT_REVIEW_RUN_OPTIONS,
    });

    expect(spawnProcess).toHaveBeenCalledWith(
      "pi",
      [
        "--mode",
        "json",
        "--model",
        "local-llama",
        "Use goal.md as the source of truth.",
      ],
      {
        cwd: repositoryPath,
        windowsHide: true,
      },
    );
    expect(runtimeState.stream.runLoop.details).toMatchObject({
      model: "local-llama",
      reasoningEffort: null,
    });

    const sessionEvent = JSON.stringify({
      type: "session",
      id: "session-1",
      model: "local-llama-v2",
    });
    const toolStartEvent = JSON.stringify({
      type: "tool_execution_start",
      toolCallId: "tool-1",
      toolName: "bash",
      args: {
        command: "npm test",
      },
    });
    const messageUpdateEvent = JSON.stringify({
      type: "message_update",
      assistantMessageEvent: {
        type: "thinking_delta",
        delta: "Pi final answer",
      },
      message: {
        role: "assistant",
        content: "Pi final answer",
      },
    });
    const messageEndEvent = JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: "Pi final answer",
        usage: {
          input_tokens: 3,
          output_tokens: 4,
        },
      },
      stopReason: "end_turn",
    });

    runProcess.stdout.write(`${sessionEvent}\n`);
    runProcess.stdout.write(`${toolStartEvent}\n`);
    runProcess.stdout.write(`${messageUpdateEvent}\n`);
    runProcess.stdout.write(`${messageEndEvent}\n`);

    expect(runtimeState.stream.logs).toEqual(
      [
        expect.objectContaining({
          stream: "stdout",
          message: `${sessionEvent}\n`,
        }),
        expect.objectContaining({
          stream: "stdout",
          message: `${toolStartEvent}\n`,
        }),
        expect.objectContaining({
          stream: "stdout",
          message: `${messageEndEvent}\n`,
        }),
      ],
    );
    expect(runtimeState.stream.runEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "agent_session_started",
          message: "Pi session started: session-1",
        }),
        expect.objectContaining({
          command: "npm test",
          kind: "command_started",
          message: "Command started: npm test",
        }),
        expect.objectContaining({
          kind: "final_assistant_message",
          message: "Pi final answer",
        }),
      ]),
    );
    expect(runtimeState.stream.runLoop.details).toMatchObject({
      lastAssistantMessage: "Pi final answer",
      model: "local-llama-v2",
      stopReason: "end_turn",
      tokenCount: 7,
    });
    runProcess.emit("close", 0, null);

    await vi.waitFor(() => {
      expect(runtimeState.stream.runLoop.latestSummary).toEqual({
        status: "complete",
        message: `Completed Pi run 1 of 1 and refreshed goal.md (${goalMarkdown.length} characters).`,
      });
    });
    expect(runtimeState.stream.runLoop.details.lastAssistantMessage).toBe(
      "Pi final answer",
    );
    expect(
      runtimeState.stream.runEvents.filter(
        (event) =>
          event.kind === "final_assistant_message" &&
          event.message === "Pi final answer",
      ),
    ).toHaveLength(1);
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
      provider: "codex",
      prompt: "Use goal.md as the source of truth.",
      runCount: 1,
      verificationCommandsToRun: [],
      autoCommit: true,
      model: null,
      reasoningEffort: null,
      claudeModel: null,
      piModel: null,
      review: {
        enabled: true,
        provider: "codex",
        intervalCommits: 1,
        prompt: "Review recent commits.",
        model: null,
        reasoningEffort: null,
        claudeModel: null,
        piModel: null,
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

  it("runs Claude review after a Codex auto-commit when review provider is Claude", async () => {
    const repositoryPath = await createRepositoryPath();
    await writeFile(path.join(repositoryPath, "goal.md"), "# Goal\n\n- [ ] Next\n");
    const runProcess = createMockRunProcess(101);
    const gitAddProcess = createMockRunProcess(102);
    const gitStatusProcess = createMockRunProcess(103);
    const gitCommitProcess = createMockRunProcess(104);
    const reviewRunProcess = createMockRunProcess(105);
    const reviewGitAddProcess = createMockRunProcess(106);
    const reviewGitStatusProcess = createMockRunProcess(107);
    const reviewGitCommitProcess = createMockRunProcess(108);
    const spawnProcess = vi
      .fn()
      .mockReturnValueOnce(runProcess)
      .mockReturnValueOnce(gitAddProcess)
      .mockReturnValueOnce(gitStatusProcess)
      .mockReturnValueOnce(gitCommitProcess)
      .mockReturnValueOnce(reviewRunProcess)
      .mockReturnValueOnce(reviewGitAddProcess)
      .mockReturnValueOnce(reviewGitStatusProcess)
      .mockReturnValueOnce(reviewGitCommitProcess);
    const runtimeState: RuntimeState = {
      selectedRepositoryPath: repositoryPath,
      stream: createInitialStreamState(),
    };
    const controller = new RunController(runtimeState, new SseHub(), spawnProcess);

    controller.start({
      repositoryPath,
      provider: "codex",
      prompt: "Use goal.md as the source of truth.",
      runCount: 1,
      verificationCommandsToRun: [],
      autoCommit: true,
      model: null,
      reasoningEffort: null,
      claudeModel: null,
      piModel: null,
      review: {
        enabled: true,
        provider: "claude",
        intervalCommits: 1,
        prompt: "Review recent commits.",
        model: null,
        reasoningEffort: null,
        claudeModel: "opus",
        piModel: null,
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
    gitStatusProcess.stdout.write(" M goal.md\n");
    gitStatusProcess.emit("close", 0, null);
    await vi.waitFor(() => {
      expect(spawnProcess).toHaveBeenCalledTimes(4);
    });
    gitCommitProcess.emit("close", 0, null);
    await vi.waitFor(() => {
      expect(spawnProcess).toHaveBeenCalledTimes(5);
    });

    expect(spawnProcess).toHaveBeenNthCalledWith(
      5,
      "claude",
      [
        "-p",
        "Review the last 1 commit for bugs, regressions, and missed requirements. Fix any issues you find, then report what you changed.\n\nReview recent commits.",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--model",
        "opus",
      ],
      {
        cwd: repositoryPath,
        windowsHide: true,
      },
    );

    reviewRunProcess.emit("close", 0, null);
    await vi.waitFor(() => {
      expect(spawnProcess).toHaveBeenCalledTimes(6);
    });
    reviewGitAddProcess.emit("close", 0, null);
    await vi.waitFor(() => {
      expect(spawnProcess).toHaveBeenCalledTimes(7);
    });
    reviewGitStatusProcess.emit("close", 0, null);
    reviewGitCommitProcess.emit("close", 0, null);

    await vi.waitFor(() => {
      expect(runtimeState.stream.runLoop.latestSummary?.status).toBe("complete");
    });
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
      provider: "codex",
      prompt: "Use goal.md as the source of truth.",
      runCount: 3,
      verificationCommandsToRun: [parsedVerification.parsed],
      autoCommit: true,
      model: "gpt-5.4",
      reasoningEffort: "medium",
      claudeModel: null,
      piModel: null,
      review: {
        enabled: true,
        provider: "codex",
        intervalCommits: 2,
        prompt: "Review recent commits.",
        model: "gpt-5.4-nano",
        reasoningEffort: "low",
        claudeModel: null,
        piModel: null,
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
        "agent-goal-runner: apply review after Codex run 2 of 3",
        "-m",
        "Generated by agent-goal-runner after review and optional verification succeeded.",
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

  it("repairs verification failures after review with the review provider settings", async () => {
    const repositoryPath = await createRepositoryPath();
    await writeFile(path.join(repositoryPath, "goal.md"), "# Goal\n\n- [ ] Next\n");
    const parsedVerification = parseVerificationCommand("npm test");

    if (!parsedVerification.success || !parsedVerification.parsed) {
      throw new Error("Expected verification command to parse.");
    }

    const runProcess = createMockRunProcess(101);
    const normalVerificationProcess = createMockRunProcess(102);
    const gitAddProcess = createMockRunProcess(103);
    const gitStatusProcess = createMockRunProcess(104);
    const gitCommitProcess = createMockRunProcess(105);
    const reviewProcess = createMockRunProcess(106);
    const failedReviewVerificationProcess = createMockRunProcess(107);
    const repairProcess = createMockRunProcess(108);
    const repairedReviewVerificationProcess = createMockRunProcess(109);
    const reviewGitAddProcess = createMockRunProcess(110);
    const reviewGitStatusProcess = createMockRunProcess(111);
    const reviewGitCommitProcess = createMockRunProcess(112);
    const spawnProcess = vi
      .fn()
      .mockReturnValueOnce(runProcess)
      .mockReturnValueOnce(normalVerificationProcess)
      .mockReturnValueOnce(gitAddProcess)
      .mockReturnValueOnce(gitStatusProcess)
      .mockReturnValueOnce(gitCommitProcess)
      .mockReturnValueOnce(reviewProcess)
      .mockReturnValueOnce(failedReviewVerificationProcess)
      .mockReturnValueOnce(repairProcess)
      .mockReturnValueOnce(repairedReviewVerificationProcess)
      .mockReturnValueOnce(reviewGitAddProcess)
      .mockReturnValueOnce(reviewGitStatusProcess)
      .mockReturnValueOnce(reviewGitCommitProcess);
    const runtimeState: RuntimeState = {
      selectedRepositoryPath: repositoryPath,
      stream: createInitialStreamState(),
    };
    const controller = new RunController(runtimeState, new SseHub(), spawnProcess);

    controller.start({
      repositoryPath,
      provider: "codex",
      prompt: "Use goal.md as the source of truth.",
      runCount: 1,
      verificationCommandsToRun: [parsedVerification.parsed],
      verificationFailure: {
        action: "repair",
        maxRepairAttempts: 1,
      },
      autoCommit: true,
      model: null,
      reasoningEffort: null,
      claudeModel: null,
      piModel: null,
      review: {
        enabled: true,
        provider: "claude",
        intervalCommits: 1,
        prompt: "Review recent commits.",
        model: null,
        reasoningEffort: null,
        claudeModel: "sonnet",
        piModel: null,
      },
    });

    runProcess.emit("close", 0, null);
    await vi.waitFor(() => {
      expect(spawnProcess).toHaveBeenCalledTimes(2);
    });
    normalVerificationProcess.emit("close", 0, null);
    await vi.waitFor(() => {
      expect(spawnProcess).toHaveBeenCalledTimes(3);
    });
    gitAddProcess.emit("close", 0, null);
    await vi.waitFor(() => {
      expect(spawnProcess).toHaveBeenCalledTimes(4);
    });
    gitStatusProcess.stdout.write(" M goal.md\n");
    gitStatusProcess.emit("close", 0, null);
    await vi.waitFor(() => {
      expect(spawnProcess).toHaveBeenCalledTimes(5);
    });
    gitCommitProcess.emit("close", 0, null);
    await vi.waitFor(() => {
      expect(spawnProcess).toHaveBeenCalledTimes(6);
    });
    reviewProcess.emit("close", 0, null);
    await vi.waitFor(() => {
      expect(spawnProcess).toHaveBeenCalledTimes(7);
    });

    failedReviewVerificationProcess.stderr.write("review verification failed\n");
    failedReviewVerificationProcess.emit("close", 1, null);
    await vi.waitFor(() => {
      expect(spawnProcess).toHaveBeenCalledTimes(8);
    });
    expect(spawnProcess).toHaveBeenNthCalledWith(
      8,
      "claude",
      expect.arrayContaining([
        "-p",
        expect.stringContaining("Phase: review for Codex run 1"),
        "--model",
        "sonnet",
      ]),
      {
        cwd: repositoryPath,
        windowsHide: true,
      },
    );

    repairProcess.emit("close", 0, null);
    await vi.waitFor(() => {
      expect(spawnProcess).toHaveBeenCalledTimes(9);
    });
    expect(spawnProcess).toHaveBeenNthCalledWith(9, "npm", ["test"], {
      cwd: repositoryPath,
      windowsHide: true,
    });
    repairedReviewVerificationProcess.emit("close", 0, null);
    await vi.waitFor(() => {
      expect(spawnProcess).toHaveBeenCalledTimes(10);
    });
    reviewGitAddProcess.emit("close", 0, null);
    await vi.waitFor(() => {
      expect(spawnProcess).toHaveBeenCalledTimes(11);
    });
    reviewGitStatusProcess.stdout.write(" M goal.md\n");
    reviewGitStatusProcess.emit("close", 0, null);
    await vi.waitFor(() => {
      expect(spawnProcess).toHaveBeenCalledTimes(12);
    });
    reviewGitCommitProcess.emit("close", 0, null);

    await vi.waitFor(() => {
      expect(runtimeState.stream.runLoop.status).toBe("complete");
    });
  });
});
