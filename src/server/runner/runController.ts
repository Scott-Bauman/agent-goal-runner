import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  detectGoalStopMarker,
  isGoalPathRestrictionError,
  readGoalMarkdown,
} from "../goal/goalFile.js";
import { isNodeErrorCode } from "../shared/nodeErrors.js";
import type { ProcessSpawner } from "../shared/process.js";
import type { RuntimeState } from "../shared/runtime.js";
import type { SseHub } from "../sse/sseHub.js";
import {
  getAgentProviderLabel,
  getAgentRunLabel,
  type AgentProvider,
} from "./agentProviders.js";
import {
  getAgentRunner,
  type AgentRunSettings,
  type StartedAgentRun,
} from "./agentRunner.js";
import type { ClaudeEffort, ClaudeModel } from "./claudeOptions.js";
import {
  createSkillPreflightStatus,
  preferSkillReferenceSyntax,
} from "./codexJsonEvents.js";
import type { CodexModel, CodexReasoningEffort } from "./codexOptions.js";
import type { ParsedVerificationCommand } from "./verificationCommand.js";

type ActiveRunProcessKind = "agent" | "review" | "verification" | "git";

type AutoCommitPhase = "agent" | "review";

type AutoCommitResult = {
  succeeded: boolean;
  committed: boolean;
};

type AgentProcessCloseContext = {
  code: number | null;
  normalCommitsSinceReview: number;
  options: StartRunOptions;
  runNumber: number;
  startedRun: StartedAgentRun;
};

type ReviewContinuationResult = {
  succeeded: boolean;
  normalCommitsSinceReview: number;
};

export type ReviewRunOptions = {
  enabled: boolean;
  provider: AgentProvider;
  intervalCommits: number;
  prompt: string;
  model: CodexModel | null;
  reasoningEffort: CodexReasoningEffort | null;
  claudeModel: ClaudeModel | null;
  claudeEffort: ClaudeEffort | null;
};

export const DEFAULT_REVIEW_RUN_OPTIONS: ReviewRunOptions = {
  enabled: false,
  provider: "codex",
  intervalCommits: 3,
  prompt: "",
  model: null,
  reasoningEffort: null,
  claudeModel: null,
  claudeEffort: null,
};

export function createReviewPromptPrefix(intervalCommits: number): string {
  const commitLabel = intervalCommits === 1 ? "commit" : "commits";

  return `Review the last ${intervalCommits} ${commitLabel} for bugs, regressions, and missed requirements. Fix any issues you find, then report what you changed.`;
}

export function createReviewPrompt(options: ReviewRunOptions): string {
  const prompt = options.prompt.trim();
  const prefix = createReviewPromptPrefix(options.intervalCommits);

  if (prompt.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())) {
    return preferSkillReferenceSyntax(prompt);
  }

  return preferSkillReferenceSyntax(`${prefix}\n\n${prompt}`);
}

export type StartRunOptions = {
  repositoryPath: string;
  provider: AgentProvider;
  prompt: string;
  runCount: number;
  verificationCommandsToRun: ParsedVerificationCommand[];
  autoCommit: boolean;
  model: CodexModel | null;
  reasoningEffort: CodexReasoningEffort | null;
  claudeModel: ClaudeModel | null;
  claudeEffort: ClaudeEffort | null;
  review: ReviewRunOptions;
};

export class RunController {
  private activeRunProcess: ChildProcessWithoutNullStreams | null = null;
  private activeRunProcessKind: ActiveRunProcessKind | null = null;
  private activeRunAgentProvider: AgentProvider | null = null;

  constructor(
    private readonly runtimeState: RuntimeState,
    private readonly sseHub: SseHub,
    private readonly spawnProcess: ProcessSpawner,
  ) {}

  // fallow-ignore-next-line unused-class-member
  hasActiveProcess(): boolean {
    return this.activeRunProcess !== null;
  }

  dispose(): void {
    this.activeRunProcess?.kill();
    this.activeRunProcess = null;
    this.activeRunProcessKind = null;
    this.activeRunAgentProvider = null;
  }

  start(options: StartRunOptions): void {
    this.startAgentRun(options, 1, 0);
  }

  // fallow-ignore-next-line unused-class-member
  requestStop(): boolean {
    if (!this.activeRunProcess) {
      return false;
    }

    const activeProcessId = this.activeRunProcess.pid ?? null;
    const activeProcessLabel =
      this.activeRunProcessKind === "verification"
        ? "verification process"
        : this.activeRunProcessKind === "git"
          ? "git process"
          : this.activeRunProcessKind === "review"
            ? "review process"
            : `${getAgentProviderLabel(this.activeRunAgentProvider ?? "codex")} process`;
    this.runtimeState.stream.runLoop = {
      ...this.runtimeState.stream.runLoop,
      status: "stopping",
      stopRequested: true,
      activeProcessId,
      latestSummary: {
        status: "stopping",
        message: `Stop requested; terminating the active ${activeProcessLabel}.`,
      },
    };
    this.publishRunStatus();

    return this.activeRunProcess.kill();
  }

  private publishRunStatus(): void {
    this.sseHub.broadcast("status", {
      status: this.runtimeState.stream.runLoop.status,
      selectedRepositoryPath: this.runtimeState.selectedRepositoryPath,
    });
    this.sseHub.broadcast("summary", this.runtimeState.stream.runLoop.latestSummary);
  }

  private failRun(message: string): void {
    this.runtimeState.stream.runLoop = {
      ...this.runtimeState.stream.runLoop,
      status: "failed",
      stopRequested: false,
      activeProcessId: null,
      latestSummary: {
        status: "failed",
        message,
      },
    };
    this.updateRunDetails({
      status: "failed",
      stopReason: message,
    });
    this.appendRunEvent("error", message, {
      stopReason: message,
    });
    this.appendRunEvent("run_completed", message, {
      stopReason: message,
    });
    this.publishRunStatus();
  }

  private handleProcessSpawnError(
    childProcess: ChildProcessWithoutNullStreams,
    message: string,
  ): void {
    if (this.activeRunProcess !== childProcess) {
      return;
    }

    this.activeRunProcess = null;
    this.activeRunProcessKind = null;
    this.activeRunAgentProvider = null;
    this.failRun(message);
  }

  private appendProcessLog(
    stream: "stdout" | "stderr",
    chunk: Buffer | string,
  ): void {
    this.sseHub.appendProcessLog(this.runtimeState.stream, stream, chunk);
  }

  private appendRunEvent(
    kind: Parameters<SseHub["appendRunEvent"]>[1]["kind"],
    message: string,
    extra: Omit<Parameters<SseHub["appendRunEvent"]>[1], "kind" | "message"> = {},
  ): void {
    this.sseHub.appendRunEvent(this.runtimeState.stream, {
      ...extra,
      kind,
      message,
    });
  }

  private updateRunDetails(
    patch: Parameters<SseHub["updateRunDetails"]>[1],
  ): void {
    this.sseHub.updateRunDetails(this.runtimeState.stream, patch);
  }

  private createLastMessageOutputPath(runNumber: number): string {
    const outputDirectory = path.join(tmpdir(), "agent-goal-runner-codex");
    mkdirSync(outputDirectory, {
      recursive: true,
    });
    return path.join(
      outputDirectory,
      `last-message-${Date.now()}-${runNumber}.txt`,
    );
  }

  private createAgentRunSettings(
    options: StartRunOptions,
    runNumber: number,
  ): AgentRunSettings {
    if (options.provider === "claude") {
      return {
        provider: "claude",
        effort: options.claudeEffort,
        model: options.claudeModel,
      };
    }

    return {
      provider: "codex",
      model: options.model,
      outputLastMessagePath: this.createLastMessageOutputPath(runNumber),
      reasoningEffort: options.reasoningEffort,
    };
  }

  private createReviewAgentRunSettings(
    review: ReviewRunOptions,
    runNumber: number,
  ): AgentRunSettings {
    if (review.provider === "claude") {
      return {
        provider: "claude",
        effort: review.claudeEffort,
        model: review.claudeModel,
      };
    }

    return {
      provider: "codex",
      model: review.model,
      outputLastMessagePath: this.createLastMessageOutputPath(runNumber),
      reasoningEffort: review.reasoningEffort,
    };
  }

  private getAgentRunDetails(options: StartRunOptions): {
    model: string | null;
    reasoningEffort: string | null;
  } {
    if (options.provider === "claude") {
      return {
        model: options.claudeModel,
        reasoningEffort: options.claudeEffort,
      };
    }

    return {
      model: options.model,
      reasoningEffort: options.reasoningEffort,
    };
  }

  private getReviewRunDetails(review: ReviewRunOptions): {
    model: string | null;
    reasoningEffort: string | null;
  } {
    if (review.provider === "claude") {
      return {
        model: review.claudeModel,
        reasoningEffort: review.claudeEffort,
      };
    }

    return {
      model: review.model,
      reasoningEffort: review.reasoningEffort,
    };
  }

  private formatAgentSpawnError(
    provider: AgentProvider,
    runNumber: number,
    error: unknown,
  ): string {
    if (provider === "claude" && isNodeErrorCode(error, "ENOENT")) {
      return "Claude Code is not installed or is not available on PATH.";
    }

    if (provider === "claude") {
      return `Failed to start Claude run ${runNumber}; ensure Claude Code is installed and available on PATH.`;
    }

    return `Failed to start Codex run ${runNumber}; ensure the Codex CLI is installed and available on PATH.`;
  }

  private formatReviewSpawnError(
    options: StartRunOptions,
    runNumber: number,
    error: unknown,
  ): string {
    const runLabel = getAgentRunLabel(options.provider);

    if (options.review.provider === "claude" && isNodeErrorCode(error, "ENOENT")) {
      return "Claude Code is not installed or is not available on PATH.";
    }

    if (options.review.provider === "claude") {
      return `Failed to start review after ${runLabel} ${runNumber}; ensure Claude Code is installed and available on PATH.`;
    }

    return `Failed to start review after ${runLabel} ${runNumber}; ensure the Codex CLI is installed and available on PATH.`;
  }

  private appendFinalAssistantMessage(finalMessage: string | null): void {
    if (!finalMessage) {
      return;
    }

    if (this.runtimeState.stream.runLoop.details.lastAssistantMessage === finalMessage) {
      return;
    }

    this.appendRunEvent("final_assistant_message", finalMessage);
  }

  private startAgentRun(
    options: StartRunOptions,
    runNumber: number,
    normalCommitsSinceReview: number,
  ): void {
    const {
      repositoryPath,
      prompt,
      runCount,
      provider,
    } = options;
    const agentPrompt = preferSkillReferenceSyntax(prompt);
    const skillPreflight = createSkillPreflightStatus(
      repositoryPath,
      agentPrompt,
      existsSync,
    );
    const runner = getAgentRunner(provider);
    const startedRun = runner.startRun({
      hooks: {
        onMetadata: (metadata) => {
          this.updateRunDetails(metadata);
        },
        onRunEvent: (event) => {
          this.sseHub.appendRunEvent(this.runtimeState.stream, event);
        },
        onStderr: (chunk) => {
          this.appendProcessLog("stderr", chunk);
        },
        onStdout: (chunk) => {
          this.appendProcessLog("stdout", chunk);
        },
      },
      prompt: agentPrompt,
      repositoryPath,
      settings: this.createAgentRunSettings(options, runNumber),
      spawnProcess: this.spawnProcess,
    });
    const childProcess = startedRun.childProcess;

    childProcess.on("error", (error) => {
      this.handleProcessSpawnError(
        childProcess,
        this.formatAgentSpawnError(options.provider, runNumber, error),
      );
    });
    childProcess.on("close", (code) => {
      void this.handleAgentProcessClose({
        code,
        normalCommitsSinceReview,
        options,
        runNumber,
        startedRun,
      });
    });
    this.activeRunProcess = childProcess;
    this.activeRunProcessKind = "agent";
    this.activeRunAgentProvider = provider;

    const modelDetails = this.getAgentRunDetails(options);
    const runLabel = getAgentRunLabel(provider);
    this.runtimeState.stream.runLoop = {
      status: "running",
      stopRequested: false,
      activeProcessId: childProcess.pid ?? null,
      progress: {
        currentRun: runNumber,
        totalRuns: runCount,
      },
      latestSummary: {
        status: "running",
        message: `Started ${runLabel} ${runNumber} of ${runCount}.`,
      },
      details: {
        status: "running",
        currentRun: runNumber,
        totalRuns: runCount,
        model: modelDetails.model,
        reasoningEffort: modelDetails.reasoningEffort,
        tokenCount: null,
        changedFiles: [],
        warningCount: 0,
        errorCount: 0,
        stopReason: null,
        lastAssistantMessage: null,
        skillPreflight,
      },
    };
    this.sseHub.broadcast("status", {
      status: this.runtimeState.stream.runLoop.status,
      selectedRepositoryPath: this.runtimeState.selectedRepositoryPath,
    });
    this.sseHub.broadcast("progress", this.runtimeState.stream.runLoop.progress);
    this.sseHub.broadcast("summary", this.runtimeState.stream.runLoop.latestSummary);
    this.sseHub.broadcast("runDetails", this.runtimeState.stream.runLoop.details);
    this.appendRunEvent(
      "run_started",
      `Started ${runLabel} ${runNumber} of ${runCount}.`,
    );

    if (skillPreflight.missing.length > 0) {
      this.appendRunEvent(
        "warning",
        `Skill preflight checked .agents/skills; missing ${skillPreflight.missing.map((skill) => `$${skill}`).join(", ")}.`,
      );
    }
  }

  private async handleAgentProcessClose(
    context: AgentProcessCloseContext,
  ): Promise<void> {
    if (this.activeRunProcess !== context.startedRun.childProcess) {
      return;
    }

    this.activeRunProcess = null;
    this.activeRunProcessKind = null;
    this.activeRunAgentProvider = null;
    this.appendFinalAssistantMessage(
      context.startedRun.complete().finalAssistantMessage,
    );

    if (this.runtimeState.stream.runLoop.stopRequested) {
      this.completeStoppedAgentRun(context.options, context.runNumber);
      return;
    }

    if (context.code !== 0) {
      this.failClosedAgentRun(context.options.provider, context.runNumber, context.code);
      return;
    }

    await this.continueAfterSuccessfulAgentRun(
      context.options,
      context.runNumber,
      context.normalCommitsSinceReview,
    );
  }

  private completeStoppedAgentRun(
    options: StartRunOptions,
    runNumber: number,
  ): void {
    const runLabel = getAgentRunLabel(options.provider);
    const message = `Stopped after ${runLabel} ${runNumber} of ${options.runCount} because stop was requested; no additional ${runLabel}s will start.`;

    this.runtimeState.stream.runLoop = {
      ...this.runtimeState.stream.runLoop,
      status: "stopped",
      stopRequested: false,
      activeProcessId: null,
      latestSummary: {
        status: "stopped",
        message,
      },
    };
    this.updateRunDetails({
      status: "stopped",
      stopReason: message,
    });
    this.appendRunEvent("run_completed", message, {
      stopReason: message,
    });
    this.publishRunStatus();
  }

  private failClosedAgentRun(
    provider: AgentProvider,
    runNumber: number,
    code: number | null,
  ): void {
    const runLabel = getAgentRunLabel(provider);

    this.failRun(
      code === null
        ? `${runLabel} ${runNumber} exited without an exit code.`
        : `${runLabel} ${runNumber} exited with code ${code}.`,
    );
  }

  private async continueAfterSuccessfulAgentRun(
    options: StartRunOptions,
    runNumber: number,
    normalCommitsSinceReview: number,
  ): Promise<void> {
    const verificationSucceeded = await this.runVerificationAfterAgentIfNeeded(
      options,
      runNumber,
    );

    if (!verificationSucceeded) {
      return;
    }

    const commitResult = await this.runAutoCommitAfterAgentIfEnabled(
      options,
      runNumber,
    );

    if (!commitResult.succeeded) {
      return;
    }

    const reviewResult = await this.runReviewAfterAgentIfDue(
      options,
      runNumber,
      normalCommitsSinceReview + (commitResult.committed ? 1 : 0),
    );

    if (!reviewResult.succeeded) {
      return;
    }

    const refreshedGoalMarkdown = await this.refreshGoalMarkdownAfterAgentRun(
      options.repositoryPath,
      options.provider,
      runNumber,
    );

    if (refreshedGoalMarkdown === null) {
      return;
    }

    if (this.stopForGoalMarker(options, runNumber, refreshedGoalMarkdown)) {
      return;
    }

    if (runNumber < options.runCount) {
      this.startAgentRun(
        options,
        runNumber + 1,
        reviewResult.normalCommitsSinceReview,
      );
      return;
    }

    this.completeFinalAgentRun(options, runNumber, refreshedGoalMarkdown);
  }

  private runVerificationAfterAgentIfNeeded(
    options: StartRunOptions,
    runNumber: number,
  ): Promise<boolean> {
    if (options.verificationCommandsToRun.length === 0) {
      return Promise.resolve(true);
    }

    return this.runVerificationCommands(options, runNumber);
  }

  private runAutoCommitAfterAgentIfEnabled(
    options: StartRunOptions,
    runNumber: number,
  ): Promise<AutoCommitResult> {
    if (!options.autoCommit) {
      return Promise.resolve({
        succeeded: true,
        committed: false,
      });
    }

    return this.runAutoCommit(options, runNumber);
  }

  private async runReviewAfterAgentIfDue(
    options: StartRunOptions,
    runNumber: number,
    normalCommitsSinceReview: number,
  ): Promise<ReviewContinuationResult> {
    const shouldRunReview =
      options.review.enabled &&
      normalCommitsSinceReview >= options.review.intervalCommits;

    if (!shouldRunReview) {
      return {
        succeeded: true,
        normalCommitsSinceReview,
      };
    }

    const reviewSucceeded = await this.runReview(options, runNumber);

    return {
      succeeded: reviewSucceeded,
      normalCommitsSinceReview: reviewSucceeded ? 0 : normalCommitsSinceReview,
    };
  }

  private async refreshGoalMarkdownAfterAgentRun(
    repositoryPath: string,
    provider: AgentProvider,
    runNumber: number,
  ): Promise<string | null> {
    try {
      return await readGoalMarkdown(repositoryPath);
    } catch (error) {
      this.failRun(this.formatGoalRefreshError(error, provider, runNumber));
      return null;
    }
  }

  private formatGoalRefreshError(
    error: unknown,
    provider: AgentProvider,
    runNumber: number,
  ): string {
    const runLabel = getAgentRunLabel(provider);

    if (isNodeErrorCode(error, "ENOENT")) {
      return `goal.md became unavailable after ${runLabel} ${runNumber}.`;
    }

    if (isGoalPathRestrictionError(error)) {
      return `goal.md resolves outside the selected repository after ${runLabel} ${runNumber}.`;
    }

    return `Failed to refresh goal.md after ${runLabel} ${runNumber}.`;
  }

  private stopForGoalMarker(
    options: StartRunOptions,
    runNumber: number,
    refreshedGoalMarkdown: string,
  ): boolean {
    const goalStopMarker = detectGoalStopMarker(refreshedGoalMarkdown);

    if (!goalStopMarker) {
      return false;
    }

    const markerStatus = goalStopMarker === "GOAL_BLOCKED" ? "blocked" : "complete";
    const runLabel = getAgentRunLabel(options.provider);
    const message = `Stopped after ${runLabel} ${runNumber} of ${options.runCount} because refreshed goal.md contains ${goalStopMarker}.`;

    this.runtimeState.stream.runLoop = {
      ...this.runtimeState.stream.runLoop,
      status: markerStatus,
      stopRequested: false,
      activeProcessId: null,
      latestSummary: {
        status: markerStatus,
        message,
      },
    };
    this.updateRunDetails({
      status: markerStatus,
      stopReason: message,
    });
    this.appendRunEvent("run_completed", message, {
      stopReason: message,
    });
    this.publishRunStatus();
    return true;
  }

  private completeFinalAgentRun(
    options: StartRunOptions,
    runNumber: number,
    refreshedGoalMarkdown: string,
  ): void {
    const runLabel = getAgentRunLabel(options.provider);
    const message = `Completed ${runLabel} ${runNumber} of ${options.runCount} and refreshed goal.md (${refreshedGoalMarkdown.length} characters).`;

    this.runtimeState.stream.runLoop = {
      ...this.runtimeState.stream.runLoop,
      status: "complete",
      stopRequested: false,
      activeProcessId: null,
      latestSummary: {
        status: "complete",
        message,
      },
    };
    this.updateRunDetails({
      status: "complete",
      stopReason: message,
    });
    this.appendRunEvent("run_completed", message, {
      stopReason: message,
    });
    this.publishRunStatus();
  }

  private async runReview(
    options: StartRunOptions,
    runNumber: number,
  ): Promise<boolean> {
    const reviewSucceeded = await this.runReviewAgent(options, runNumber);

    if (!reviewSucceeded) {
      return false;
    }

    if (options.verificationCommandsToRun.length > 0) {
      const verificationSucceeded = await this.runVerificationCommands(
        options,
        runNumber,
        "review",
      );

      if (!verificationSucceeded) {
        return false;
      }
    }

    const commitResult = await this.runAutoCommit(options, runNumber, "review");

    return commitResult.succeeded;
  }

  private runReviewAgent(
    options: StartRunOptions,
    runNumber: number,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const reviewPrompt = createReviewPrompt(options.review);
      const skillPreflight = createSkillPreflightStatus(
        options.repositoryPath,
        reviewPrompt,
        existsSync,
      );
      const runner = getAgentRunner(options.review.provider);
      const startedRun = runner.startRun({
        hooks: {
          onMetadata: (metadata) => {
            this.updateRunDetails(metadata);
          },
          onRunEvent: (event) => {
            this.sseHub.appendRunEvent(this.runtimeState.stream, event);
          },
          onStderr: (chunk) => {
            this.appendProcessLog("stderr", chunk);
          },
          onStdout: (chunk) => {
            this.appendProcessLog("stdout", chunk);
          },
        },
        prompt: reviewPrompt,
        repositoryPath: options.repositoryPath,
        settings: this.createReviewAgentRunSettings(options.review, runNumber),
        spawnProcess: this.spawnProcess,
      });
      const childProcess = startedRun.childProcess;
      const runLabel = getAgentRunLabel(options.provider);
      const startMessage =
        `Started review of the last ${options.review.intervalCommits} commits ` +
        `after ${runLabel} ${runNumber} of ${options.runCount}.`;

      childProcess.on("error", (error) => {
        this.handleProcessSpawnError(
          childProcess,
          this.formatReviewSpawnError(options, runNumber, error),
        );
        resolve(false);
      });
      childProcess.on("close", (code) => {
        if (this.activeRunProcess !== childProcess) {
          resolve(false);
          return;
        }

        this.activeRunProcess = null;
        this.activeRunProcessKind = null;
        this.activeRunAgentProvider = null;
        this.appendFinalAssistantMessage(
          startedRun.complete().finalAssistantMessage,
        );

        if (this.runtimeState.stream.runLoop.stopRequested) {
          const message =
            `Stopped after review for ${runLabel} ${runNumber} of ${options.runCount} ` +
            `because stop was requested; no additional ${runLabel}s will start.`;
          this.runtimeState.stream.runLoop = {
            ...this.runtimeState.stream.runLoop,
            status: "stopped",
            stopRequested: false,
            activeProcessId: null,
            latestSummary: {
              status: "stopped",
              message,
            },
          };
          this.updateRunDetails({
            status: "stopped",
            stopReason: message,
          });
          this.appendRunEvent("run_completed", message, {
            stopReason: message,
          });
          this.publishRunStatus();
          resolve(false);
          return;
        }

        if (code === 0) {
          this.appendRunEvent(
            "command_succeeded",
            `Review after ${runLabel} ${runNumber} succeeded.`,
            {
              command: startedRun.commandDisplay,
              exitCode: 0,
            },
          );
          resolve(true);
          return;
        }

        this.failRun(
          code === null
            ? `Review after ${runLabel} ${runNumber} exited without an exit code.`
            : `Review after ${runLabel} ${runNumber} exited with code ${code}.`,
        );
        resolve(false);
      });

      this.activeRunProcess = childProcess;
      this.activeRunProcessKind = "review";
      this.activeRunAgentProvider = options.review.provider;
      this.runtimeState.stream.runLoop = {
        ...this.runtimeState.stream.runLoop,
        activeProcessId: childProcess.pid ?? null,
        latestSummary: {
          status: "running",
          message: startMessage,
        },
      };
      this.updateRunDetails({
        status: "running",
        ...this.getReviewRunDetails(options.review),
        tokenCount: null,
        lastAssistantMessage: null,
        skillPreflight,
      });
      this.publishRunStatus();
      this.appendRunEvent("run_started", startMessage);

      if (skillPreflight.missing.length > 0) {
        this.appendRunEvent(
          "warning",
          `Skill preflight checked .agents/skills; missing ${skillPreflight.missing.map((skill) => `$${skill}`).join(", ")}.`,
        );
      }
    });
  }

  private async runAutoCommit(
    options: StartRunOptions,
    runNumber: number,
    phase: AutoCommitPhase = "agent",
  ): Promise<AutoCommitResult> {
    const messages = this.createAutoCommitMessages(options, runNumber, phase);
    const addSucceeded = await this.runGitCommand(
      options,
      ["add", "-A"],
      messages.stageStarted,
      messages.stageFailed,
      messages.stopped,
    );

    if (!addSucceeded) {
      return {
        succeeded: false,
        committed: false,
      };
    }

    const statusOutput = await this.runGitStatusBeforeCommit(
      options,
      runNumber,
      phase,
    );

    if (statusOutput === null) {
      return {
        succeeded: false,
        committed: false,
      };
    }

    if (statusOutput.trim().length === 0) {
      this.runtimeState.stream.runLoop = {
        ...this.runtimeState.stream.runLoop,
        activeProcessId: null,
        latestSummary: {
          status: "running",
          message: messages.skipped,
        },
      };
      this.publishRunStatus();
      return {
        succeeded: true,
        committed: false,
      };
    }

    const commitSucceeded = await this.runGitCommand(
      options,
      [
        "commit",
        ...this.createAutoCommitMessageArgs(
          runNumber,
          options.runCount,
          phase,
          options.provider,
        ),
      ],
      messages.commitStarted,
      messages.commitFailed,
      messages.stopped,
    );

    return {
      succeeded: commitSucceeded,
      committed: commitSucceeded,
    };
  }

  private createAutoCommitMessageArgs(
    runNumber: number,
    totalRuns: number,
    phase: AutoCommitPhase = "agent",
    provider: AgentProvider = "codex",
  ): string[] {
    const runLabel = getAgentRunLabel(provider);

    if (phase === "review") {
      return [
        "-m",
        `codex-goal-runner: apply review after ${runLabel} ${runNumber} of ${totalRuns}`,
        "-m",
        "Generated by codex-goal-runner after review and optional verification succeeded.",
      ];
    }

    return [
      "-m",
      `codex-goal-runner: apply ${runLabel} ${runNumber} of ${totalRuns}`,
      "-m",
      `Generated by codex-goal-runner after ${getAgentProviderLabel(provider)} and optional verification succeeded.`,
    ];
  }

  private createAutoCommitMessages(
    options: StartRunOptions,
    runNumber: number,
    phase: AutoCommitPhase,
  ): {
    stageStarted: string;
    stageFailed: (code: number | null) => string;
    statusStarted: string;
    statusFailed: (code: number | null) => string;
    commitStarted: string;
    commitFailed: (code: number | null) => string;
    skipped: string;
    stopped: string;
  } {
    const runLabel = getAgentRunLabel(options.provider);

    if (phase === "review") {
      return {
        stageStarted: `Started review auto-commit staging after ${runLabel} ${runNumber} of ${options.runCount}.`,
        stageFailed: (code) =>
          code === null
            ? `Review auto-commit staging after ${runLabel} ${runNumber} exited without an exit code.`
            : `Review auto-commit staging after ${runLabel} ${runNumber} exited with code ${code}.`,
        statusStarted: `Started review auto-commit status check after ${runLabel} ${runNumber} of ${options.runCount}.`,
        statusFailed: (code) =>
          code === null
            ? `Review auto-commit status check after ${runLabel} ${runNumber} exited without an exit code.`
            : `Review auto-commit status check after ${runLabel} ${runNumber} exited with code ${code}.`,
        commitStarted: `Started review auto-commit after ${runLabel} ${runNumber} of ${options.runCount}.`,
        commitFailed: (code) =>
          code === null
            ? `Review auto-commit after ${runLabel} ${runNumber} exited without an exit code.`
            : `Review auto-commit after ${runLabel} ${runNumber} exited with code ${code}.`,
        skipped: `Skipped review auto-commit after ${runLabel} ${runNumber} of ${options.runCount} because git status reported no changes.`,
        stopped: `Stopped during review auto-commit after ${runLabel} ${runNumber} of ${options.runCount} because stop was requested; no additional ${runLabel}s will start.`,
      };
    }

    return {
      stageStarted: `Started auto-commit staging after ${runLabel} ${runNumber} of ${options.runCount}.`,
      stageFailed: (code) =>
        code === null
          ? `Auto-commit staging after ${runLabel} ${runNumber} exited without an exit code.`
          : `Auto-commit staging after ${runLabel} ${runNumber} exited with code ${code}.`,
      statusStarted: `Started auto-commit status check after ${runLabel} ${runNumber} of ${options.runCount}.`,
      statusFailed: (code) =>
        code === null
          ? `Auto-commit status check after ${runLabel} ${runNumber} exited without an exit code.`
          : `Auto-commit status check after ${runLabel} ${runNumber} exited with code ${code}.`,
      commitStarted: `Started auto-commit after ${runLabel} ${runNumber} of ${options.runCount}.`,
      commitFailed: (code) =>
        code === null
          ? `Auto-commit after ${runLabel} ${runNumber} exited without an exit code.`
          : `Auto-commit after ${runLabel} ${runNumber} exited with code ${code}.`,
      skipped: `Skipped auto-commit after ${runLabel} ${runNumber} of ${options.runCount} because git status reported no changes.`,
      stopped: `Stopped during auto-commit after ${runLabel} ${runNumber} of ${options.runCount} because stop was requested; no additional ${runLabel}s will start.`,
    };
  }

  private runGitStatusBeforeCommit(
    options: StartRunOptions,
    runNumber: number,
    phase: AutoCommitPhase,
  ): Promise<string | null> {
    return new Promise((resolve) => {
      let stdout = "";
      const messages = this.createAutoCommitMessages(options, runNumber, phase);
      const gitProcess = this.spawnProcess("git", ["status", "--porcelain"], {
        cwd: options.repositoryPath,
        windowsHide: true,
      });

      this.activeRunProcess = gitProcess;
      this.activeRunProcessKind = "git";
      this.runtimeState.stream.runLoop = {
        ...this.runtimeState.stream.runLoop,
        activeProcessId: gitProcess.pid ?? null,
        latestSummary: {
          status: "running",
          message: messages.statusStarted,
        },
      };
      this.publishRunStatus();
      this.appendRunEvent(
        "command_started",
        messages.statusStarted,
        {
          command: "git status --porcelain",
        },
      );

      gitProcess.stdout.on("data", (chunk: Buffer | string) => {
        stdout += chunk.toString();
        this.appendProcessLog("stdout", chunk);
      });
      gitProcess.stderr.on("data", (chunk: Buffer | string) => {
        this.appendProcessLog("stderr", chunk);
      });
      gitProcess.on("error", () => {
        this.handleProcessSpawnError(
          gitProcess,
          `Failed to start auto-commit status check after ${getAgentRunLabel(options.provider)} ${runNumber}; ensure git is installed and available on PATH.`,
        );
        resolve(null);
      });
      gitProcess.on("close", (code) => {
        if (this.activeRunProcess !== gitProcess) {
          resolve(null);
          return;
        }

        this.activeRunProcess = null;
        this.activeRunProcessKind = null;

        if (this.runtimeState.stream.runLoop.stopRequested) {
          this.runtimeState.stream.runLoop = {
            ...this.runtimeState.stream.runLoop,
            status: "stopped",
            stopRequested: false,
            activeProcessId: null,
            latestSummary: {
              status: "stopped",
              message: messages.stopped,
            },
          };
          this.publishRunStatus();
          resolve(null);
          return;
        }

        if (code === 0) {
          this.appendRunEvent(
            "command_succeeded",
            `Auto-commit status check after ${getAgentRunLabel(options.provider)} ${runNumber} succeeded.`,
            {
              command: "git status --porcelain",
              exitCode: 0,
            },
          );
          resolve(stdout);
          return;
        }

        const message = messages.statusFailed(code);
        this.appendRunEvent("command_failed", message, {
          command: "git status --porcelain",
          exitCode: code ?? undefined,
        });
        this.failRun(message);
        resolve(null);
      });
    });
  }

  private runGitCommand(
    options: StartRunOptions,
    args: string[],
    startMessage: string,
    failureMessage: (code: number | null) => string,
    stopMessage: string,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const gitProcess = this.spawnProcess("git", args, {
        cwd: options.repositoryPath,
        windowsHide: true,
      });

      this.activeRunProcess = gitProcess;
      this.activeRunProcessKind = "git";
      this.runtimeState.stream.runLoop = {
        ...this.runtimeState.stream.runLoop,
        activeProcessId: gitProcess.pid ?? null,
        latestSummary: {
          status: "running",
          message: startMessage,
        },
      };
      this.publishRunStatus();
      this.appendRunEvent("command_started", startMessage, {
        command: ["git", ...args].join(" "),
      });

      gitProcess.stdout.on("data", (chunk: Buffer | string) => {
        this.appendProcessLog("stdout", chunk);
      });
      gitProcess.stderr.on("data", (chunk: Buffer | string) => {
        this.appendProcessLog("stderr", chunk);
      });
      gitProcess.on("error", () => {
        this.handleProcessSpawnError(
          gitProcess,
          "Failed to start git for auto-commit; ensure git is installed and available on PATH.",
        );
        resolve(false);
      });
      gitProcess.on("close", (code) => {
        if (this.activeRunProcess !== gitProcess) {
          resolve(false);
          return;
        }

        this.activeRunProcess = null;
        this.activeRunProcessKind = null;

        if (this.runtimeState.stream.runLoop.stopRequested) {
          this.runtimeState.stream.runLoop = {
            ...this.runtimeState.stream.runLoop,
            status: "stopped",
            stopRequested: false,
            activeProcessId: null,
            latestSummary: {
              status: "stopped",
              message: stopMessage,
            },
          };
          this.publishRunStatus();
          resolve(false);
          return;
        }

        if (code === 0) {
          this.appendRunEvent(
            "command_succeeded",
            startMessage.replace(/^Started /, "Completed "),
            {
              command: ["git", ...args].join(" "),
              exitCode: 0,
            },
          );
          resolve(true);
          return;
        }

        const message = failureMessage(code);
        this.appendRunEvent("command_failed", message, {
          command: ["git", ...args].join(" "),
          exitCode: code ?? undefined,
        });
        this.failRun(message);
        resolve(false);
      });
    });
  }

  private async runVerificationCommands(
    options: StartRunOptions,
    runNumber: number,
    phase: AutoCommitPhase = "agent",
  ): Promise<boolean> {
    for (const [
      commandIndex,
      verificationCommand,
    ] of options.verificationCommandsToRun.entries()) {
      const commandSucceeded = await this.runVerificationCommand(
        options,
        runNumber,
        verificationCommand,
        commandIndex,
        phase,
      );

      if (!commandSucceeded) {
        return false;
      }
    }

    return true;
  }

  private runVerificationCommand(
    options: StartRunOptions,
    runNumber: number,
    verificationCommandToRun: ParsedVerificationCommand,
    commandIndex: number,
    phase: AutoCommitPhase,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const commandNumber = commandIndex + 1;
      const commandTotal = options.verificationCommandsToRun.length;
      const commandLabel =
        commandTotal === 1
          ? "verification"
          : `verification command ${commandNumber} of ${commandTotal}`;
      const runLabel = getAgentRunLabel(options.provider);
      const phaseLabel =
        phase === "review"
          ? `review for ${runLabel} ${runNumber} of ${options.runCount}`
          : `${runLabel} ${runNumber} of ${options.runCount}`;
      const phaseShortLabel =
        phase === "review"
          ? `review for ${runLabel} ${runNumber}`
          : `${runLabel} ${runNumber}`;
      const verificationProcess = this.spawnProcess(
        verificationCommandToRun.executable,
        verificationCommandToRun.args,
        {
          cwd: options.repositoryPath,
          windowsHide: true,
        },
      );

      this.activeRunProcess = verificationProcess;
      this.activeRunProcessKind = "verification";
      this.runtimeState.stream.runLoop = {
        ...this.runtimeState.stream.runLoop,
        activeProcessId: verificationProcess.pid ?? null,
        latestSummary: {
          status: "running",
          message: `Started ${commandLabel} after ${phaseLabel}.`,
        },
      };
      this.publishRunStatus();
      this.appendRunEvent(
        "command_started",
        `Started ${commandLabel} after ${phaseLabel}.`,
        {
          command: [
            verificationCommandToRun.executable,
            ...verificationCommandToRun.args,
          ].join(" "),
        },
      );

      verificationProcess.stdout.on("data", (chunk: Buffer | string) => {
        this.appendProcessLog("stdout", chunk);
      });
      verificationProcess.stderr.on("data", (chunk: Buffer | string) => {
        this.appendProcessLog("stderr", chunk);
      });
      verificationProcess.on("error", () => {
        this.handleProcessSpawnError(
          verificationProcess,
          `Failed to start ${commandLabel} after ${runLabel} ${runNumber}; ensure the verification executable is installed and available on PATH.`,
        );
        resolve(false);
      });
      verificationProcess.on("close", (code) => {
        if (this.activeRunProcess !== verificationProcess) {
          resolve(false);
          return;
        }

        this.activeRunProcess = null;
        this.activeRunProcessKind = null;

        if (this.runtimeState.stream.runLoop.stopRequested) {
          this.runtimeState.stream.runLoop = {
            ...this.runtimeState.stream.runLoop,
            status: "stopped",
            stopRequested: false,
            activeProcessId: null,
            latestSummary: {
              status: "stopped",
              message: `Stopped after verification for ${phaseLabel} because stop was requested; no additional ${runLabel}s will start.`,
            },
          };
          this.publishRunStatus();
          resolve(false);
          return;
        }

        if (code === 0) {
          this.appendRunEvent(
            "command_succeeded",
            `${capitalize(commandLabel)} after ${phaseShortLabel} succeeded.`,
            {
              command: [
                verificationCommandToRun.executable,
                ...verificationCommandToRun.args,
              ].join(" "),
              exitCode: 0,
            },
          );
          resolve(true);
          return;
        }

        const message =
          code === null
            ? `${capitalize(commandLabel)} after ${phaseShortLabel} exited without an exit code.`
            : `${capitalize(commandLabel)} after ${phaseShortLabel} exited with code ${code}.`;
        this.appendRunEvent("command_failed", message, {
          command: [
            verificationCommandToRun.executable,
            ...verificationCommandToRun.args,
          ].join(" "),
          exitCode: code ?? undefined,
        });
        this.failRun(message);
        resolve(false);
      });
    });
  }
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
