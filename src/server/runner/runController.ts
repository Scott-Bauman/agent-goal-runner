import type { ChildProcessWithoutNullStreams } from "node:child_process";

import {
  detectGoalStopMarker,
  isGoalPathRestrictionError,
  readGoalMarkdown,
} from "../goal/goalFile.js";
import { isNodeErrorCode } from "../shared/nodeErrors.js";
import type { ProcessSpawner } from "../shared/process.js";
import type { RuntimeState } from "../shared/runtime.js";
import type { SseHub } from "../sse/sseHub.js";
import { getCodexExecSpawnCommand } from "./codexCommand.js";
import type { ParsedVerificationCommand } from "./verificationCommand.js";

type ActiveRunProcessKind = "codex" | "verification" | "git";

export type StartRunOptions = {
  repositoryPath: string;
  prompt: string;
  runCount: number;
  verificationCommandToRun: ParsedVerificationCommand | null;
  autoCommit: boolean;
};

export class RunController {
  private activeRunProcess: ChildProcessWithoutNullStreams | null = null;
  private activeRunProcessKind: ActiveRunProcessKind | null = null;

  constructor(
    private readonly runtimeState: RuntimeState,
    private readonly sseHub: SseHub,
    private readonly spawnProcess: ProcessSpawner,
  ) {}

  hasActiveProcess(): boolean {
    return this.activeRunProcess !== null;
  }

  dispose(): void {
    this.activeRunProcess?.kill();
    this.activeRunProcess = null;
    this.activeRunProcessKind = null;
  }

  start(options: StartRunOptions): void {
    this.startCodexRun(options, 1);
  }

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
          : "Codex process";
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
    this.failRun(message);
  }

  private appendProcessLog(
    stream: "stdout" | "stderr",
    chunk: Buffer | string,
  ): void {
    this.sseHub.appendProcessLog(this.runtimeState.stream, stream, chunk);
  }

  private startCodexRun(options: StartRunOptions, runNumber: number): void {
    const { repositoryPath, prompt, runCount, verificationCommandToRun, autoCommit } =
      options;
    const codexCommand = getCodexExecSpawnCommand(prompt);
    const childProcess = this.spawnProcess(codexCommand.command, codexCommand.args, {
      cwd: repositoryPath,
      windowsHide: true,
    });

    childProcess.stdout.on("data", (chunk: Buffer | string) => {
      this.appendProcessLog("stdout", chunk);
    });
    childProcess.stderr.on("data", (chunk: Buffer | string) => {
      this.appendProcessLog("stderr", chunk);
    });
    childProcess.stdin.end();
    childProcess.on("error", () => {
      this.handleProcessSpawnError(
        childProcess,
        `Failed to start Codex run ${runNumber}; ensure the Codex CLI is installed and available on PATH.`,
      );
    });
    childProcess.on("close", (code) => {
      void (async () => {
        if (this.activeRunProcess !== childProcess) {
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
              message: `Stopped after Codex run ${runNumber} of ${runCount} because stop was requested; no additional Codex runs will start.`,
            },
          };
          this.publishRunStatus();
          return;
        }

        if (code === 0) {
          if (verificationCommandToRun) {
            const verificationSucceeded = await this.runVerificationCommand(
              options,
              runNumber,
            );

            if (!verificationSucceeded) {
              return;
            }
          }

          if (autoCommit) {
            const commitSucceeded = await this.runAutoCommit(options, runNumber);

            if (!commitSucceeded) {
              return;
            }
          }

          let refreshedGoalMarkdown: string;

          try {
            refreshedGoalMarkdown = await readGoalMarkdown(repositoryPath);
          } catch (error) {
            this.failRun(
              isNodeErrorCode(error, "ENOENT")
                ? `goal.md became unavailable after Codex run ${runNumber}.`
                : isGoalPathRestrictionError(error)
                  ? `goal.md resolves outside the selected repository after Codex run ${runNumber}.`
                  : `Failed to refresh goal.md after Codex run ${runNumber}.`,
            );
            return;
          }

          const goalStopMarker = detectGoalStopMarker(refreshedGoalMarkdown);

          if (goalStopMarker) {
            const markerStatus =
              goalStopMarker === "GOAL_BLOCKED" ? "blocked" : "complete";

            this.runtimeState.stream.runLoop = {
              ...this.runtimeState.stream.runLoop,
              status: markerStatus,
              stopRequested: false,
              activeProcessId: null,
              latestSummary: {
                status: markerStatus,
                message: `Stopped after Codex run ${runNumber} of ${runCount} because refreshed goal.md contains ${goalStopMarker}.`,
              },
            };
            this.publishRunStatus();
            return;
          }

          if (runNumber < runCount) {
            this.startCodexRun(options, runNumber + 1);
            return;
          }

          this.runtimeState.stream.runLoop = {
            ...this.runtimeState.stream.runLoop,
            status: "complete",
            stopRequested: false,
            activeProcessId: null,
            latestSummary: {
              status: "complete",
              message: `Completed Codex run ${runNumber} of ${runCount} and refreshed goal.md (${refreshedGoalMarkdown.length} characters).`,
            },
          };
          this.publishRunStatus();
          return;
        }

        this.failRun(
          code === null
            ? `Codex run ${runNumber} exited without an exit code.`
            : `Codex run ${runNumber} exited with code ${code}.`,
        );
      })();
    });
    this.activeRunProcess = childProcess;
    this.activeRunProcessKind = "codex";

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
        message: `Started Codex run ${runNumber} of ${runCount}.`,
      },
    };
    this.sseHub.broadcast("status", {
      status: this.runtimeState.stream.runLoop.status,
      selectedRepositoryPath: this.runtimeState.selectedRepositoryPath,
    });
    this.sseHub.broadcast("progress", this.runtimeState.stream.runLoop.progress);
    this.sseHub.broadcast("summary", this.runtimeState.stream.runLoop.latestSummary);
  }

  private async runAutoCommit(
    options: StartRunOptions,
    runNumber: number,
  ): Promise<boolean> {
    const addSucceeded = await this.runGitCommand(
      options,
      ["add", "-A"],
      `Started auto-commit staging after Codex run ${runNumber} of ${options.runCount}.`,
      (code) =>
        code === null
          ? `Auto-commit staging after Codex run ${runNumber} exited without an exit code.`
          : `Auto-commit staging after Codex run ${runNumber} exited with code ${code}.`,
      runNumber,
    );

    if (!addSucceeded) {
      return false;
    }

    const statusOutput = await this.runGitStatusBeforeCommit(options, runNumber);

    if (statusOutput === null) {
      return false;
    }

    if (statusOutput.trim().length === 0) {
      this.runtimeState.stream.runLoop = {
        ...this.runtimeState.stream.runLoop,
        activeProcessId: null,
        latestSummary: {
          status: "running",
          message: `Skipped auto-commit after Codex run ${runNumber} of ${options.runCount} because git status reported no changes.`,
        },
      };
      this.publishRunStatus();
      return true;
    }

    return this.runGitCommand(
      options,
      ["commit", ...this.createAutoCommitMessageArgs(runNumber, options.runCount)],
      `Started auto-commit after Codex run ${runNumber} of ${options.runCount}.`,
      (code) =>
        code === null
          ? `Auto-commit after Codex run ${runNumber} exited without an exit code.`
          : `Auto-commit after Codex run ${runNumber} exited with code ${code}.`,
      runNumber,
    );
  }

  private createAutoCommitMessageArgs(
    runNumber: number,
    totalRuns: number,
  ): string[] {
    return [
      "-m",
      `codex-goal-runner: apply Codex run ${runNumber} of ${totalRuns}`,
      "-m",
      "Generated by codex-goal-runner after Codex and optional verification succeeded.",
    ];
  }

  private runGitStatusBeforeCommit(
    options: StartRunOptions,
    runNumber: number,
  ): Promise<string | null> {
    return new Promise((resolve) => {
      let stdout = "";
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
          message: `Started auto-commit status check after Codex run ${runNumber} of ${options.runCount}.`,
        },
      };
      this.publishRunStatus();

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
          `Failed to start auto-commit status check after Codex run ${runNumber}; ensure git is installed and available on PATH.`,
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
              message: `Stopped during auto-commit status check after Codex run ${runNumber} of ${options.runCount} because stop was requested; no additional Codex runs will start.`,
            },
          };
          this.publishRunStatus();
          resolve(null);
          return;
        }

        if (code === 0) {
          resolve(stdout);
          return;
        }

        this.failRun(
          code === null
            ? `Auto-commit status check after Codex run ${runNumber} exited without an exit code.`
            : `Auto-commit status check after Codex run ${runNumber} exited with code ${code}.`,
        );
        resolve(null);
      });
    });
  }

  private runGitCommand(
    options: StartRunOptions,
    args: string[],
    startMessage: string,
    failureMessage: (code: number | null) => string,
    runNumber: number,
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
              message: `Stopped during auto-commit after Codex run ${runNumber} of ${options.runCount} because stop was requested; no additional Codex runs will start.`,
            },
          };
          this.publishRunStatus();
          resolve(false);
          return;
        }

        if (code === 0) {
          resolve(true);
          return;
        }

        this.failRun(failureMessage(code));
        resolve(false);
      });
    });
  }

  private runVerificationCommand(
    options: StartRunOptions,
    runNumber: number,
  ): Promise<boolean> {
    const verificationCommandToRun = options.verificationCommandToRun;

    if (!verificationCommandToRun) {
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
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
          message: `Started verification after Codex run ${runNumber} of ${options.runCount}.`,
        },
      };
      this.publishRunStatus();

      verificationProcess.stdout.on("data", (chunk: Buffer | string) => {
        this.appendProcessLog("stdout", chunk);
      });
      verificationProcess.stderr.on("data", (chunk: Buffer | string) => {
        this.appendProcessLog("stderr", chunk);
      });
      verificationProcess.on("error", () => {
        this.handleProcessSpawnError(
          verificationProcess,
          `Failed to start verification after Codex run ${runNumber}; ensure the verification executable is installed and available on PATH.`,
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
              message: `Stopped after verification for Codex run ${runNumber} of ${options.runCount} because stop was requested; no additional Codex runs will start.`,
            },
          };
          this.publishRunStatus();
          resolve(false);
          return;
        }

        if (code === 0) {
          resolve(true);
          return;
        }

        this.failRun(
          code === null
            ? `Verification after Codex run ${runNumber} exited without an exit code.`
            : `Verification after Codex run ${runNumber} exited with code ${code}.`,
        );
        resolve(false);
      });
    });
  }
}
