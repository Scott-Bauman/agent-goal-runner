import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import type { RunSummaryDetails } from "../sse/types.js";
import type { ProcessSpawner } from "../shared/process.js";
import type { RunEventPayload } from "../sse/types.js";
import { getClaudePrintSpawnCommand } from "./claudeCommand.js";
import type { ClaudeEffort, ClaudeModel } from "./claudeOptions.js";
import { getCodexExecSpawnCommand } from "./codexCommand.js";
import { CodexJsonEventParser } from "./codexJsonEvents.js";
import type { CodexModel, CodexReasoningEffort } from "./codexOptions.js";
import type { AgentProvider } from "./agentProviders.js";

export type AgentRunSettings =
  | {
      provider: "codex";
      model: CodexModel | null;
      outputLastMessagePath: string;
      reasoningEffort: CodexReasoningEffort | null;
    }
  | {
      provider: "claude";
      effort: ClaudeEffort | null;
      model: ClaudeModel | null;
    };

type AgentRunHooks = {
  onMetadata: (metadata: Partial<RunSummaryDetails>) => void;
  onRunEvent: (event: RunEventPayload) => void;
  onStderr: (chunk: Buffer | string) => void;
  onStdout: (chunk: Buffer | string) => void;
};

export type StartedAgentRun = {
  childProcess: ChildProcessWithoutNullStreams;
  commandDisplay: string;
  complete: () => {
    finalAssistantMessage: string | null;
  };
  provider: AgentProvider;
};

export type AgentRunner = {
  provider: AgentProvider;
  startRun: (options: {
    hooks: AgentRunHooks;
    prompt: string;
    repositoryPath: string;
    settings: AgentRunSettings;
    spawnProcess: ProcessSpawner;
  }) => StartedAgentRun;
};

export function getAgentRunner(provider: AgentProvider): AgentRunner {
  return provider === "claude" ? claudeRunner : codexRunner;
}

const codexRunner: AgentRunner = {
  provider: "codex",
  startRun({ hooks, prompt, repositoryPath, settings, spawnProcess }) {
    if (settings.provider !== "codex") {
      throw new Error("Codex runner received non-Codex settings.");
    }

    const parser = new CodexJsonEventParser();
    const codexCommand = getCodexExecSpawnCommand(prompt, {
      model: settings.model,
      outputLastMessagePath: settings.outputLastMessagePath,
      reasoningEffort: settings.reasoningEffort,
    });
    const childProcess = spawnProcess(codexCommand.command, codexCommand.args, {
      cwd: repositoryPath,
      windowsHide: true,
    });

    childProcess.stdout.on("data", (chunk: Buffer | string) => {
      hooks.onStdout(chunk);
      const parsedChunk = parser.push(chunk);

      for (const event of parsedChunk.events) {
        hooks.onRunEvent(event);
      }

      hooks.onMetadata(parsedChunk.metadata);
    });
    childProcess.stderr.on("data", hooks.onStderr);
    childProcess.stdin.end();

    return {
      childProcess,
      commandDisplay: "codex exec",
      complete() {
        const parsedRemainder = parser.flush();

        for (const event of parsedRemainder.events) {
          hooks.onRunEvent(event);
        }

        hooks.onMetadata(parsedRemainder.metadata);

        return {
          finalAssistantMessage: readFinalMessageFile(
            settings.outputLastMessagePath,
          ),
        };
      },
      provider: "codex",
    };
  },
};

const claudeRunner: AgentRunner = {
  provider: "claude",
  startRun({ hooks, prompt, repositoryPath, settings, spawnProcess }) {
    if (settings.provider !== "claude") {
      throw new Error("Claude runner received non-Claude settings.");
    }

    let stdout = "";
    const claudeCommand = getClaudePrintSpawnCommand(prompt, {
      effort: settings.effort,
      model: settings.model,
    });
    const childProcess = spawnProcess(claudeCommand.command, claudeCommand.args, {
      cwd: repositoryPath,
      windowsHide: true,
    });

    childProcess.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
      hooks.onStdout(chunk);
    });
    childProcess.stderr.on("data", hooks.onStderr);
    childProcess.stdin.end();

    return {
      childProcess,
      commandDisplay: "claude -p",
      complete() {
        const finalAssistantMessage = stdout.trim();

        return {
          finalAssistantMessage:
            finalAssistantMessage.length > 0 ? finalAssistantMessage : null,
        };
      },
      provider: "claude",
    };
  },
};

function readFinalMessageFile(outputPath: string): string | null {
  if (!existsSync(outputPath)) {
    return null;
  }

  const finalMessage = readFileSync(outputPath, "utf8").trim();

  return finalMessage.length > 0 ? finalMessage : null;
}
