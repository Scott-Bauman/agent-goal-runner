import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import type { RunSummaryDetails } from "../sse/types.js";
import type { ProcessSpawner } from "../shared/process.js";
import type { RunEventPayload } from "../sse/types.js";
import { getClaudeStreamJsonSpawnCommand } from "./claudeCommand.js";
import { ClaudeJsonEventParser } from "./claudeJsonEvents.js";
import type { ClaudeModel } from "./claudeOptions.js";
import { getCodexExecSpawnCommand } from "./codexCommand.js";
import { CodexJsonEventParser } from "./codexJsonEvents.js";
import type { CodexModel, CodexReasoningEffort } from "./codexOptions.js";
import type { AgentProvider } from "./agentProviders.js";
import { getPiPrintSpawnCommand } from "./piCommand.js";

export type AgentRunSettings =
  | {
      provider: "codex";
      model: CodexModel | null;
      outputLastMessagePath: string;
      reasoningEffort: CodexReasoningEffort | null;
    }
  | {
      provider: "claude";
      model: ClaudeModel | null;
    }
  | {
      provider: "pi";
      piModel: string | null;
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
  if (provider === "claude") {
    return claudeRunner;
  }

  if (provider === "pi") {
    return piRunner;
  }

  return codexRunner;
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

    const parser = new ClaudeJsonEventParser();
    const claudeCommand = getClaudeStreamJsonSpawnCommand(prompt, {
      model: settings.model,
    });
    const childProcess = spawnProcess(claudeCommand.command, claudeCommand.args, {
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
      commandDisplay: "claude -p --output-format stream-json",
      complete() {
        const parsedRemainder = parser.flush();

        for (const event of parsedRemainder.events) {
          hooks.onRunEvent(event);
        }

        hooks.onMetadata(parsedRemainder.metadata);

        return {
          finalAssistantMessage: parser.getFinalAssistantMessage(),
        };
      },
      provider: "claude",
    };
  },
};

const piRunner: AgentRunner = {
  provider: "pi",
  startRun({ hooks, prompt, repositoryPath, settings, spawnProcess }) {
    if (settings.provider !== "pi") {
      throw new Error("Pi runner received non-Pi settings.");
    }

    let stdout = "";
    const piCommand = getPiPrintSpawnCommand(prompt, {
      model: settings.piModel,
    });
    const childProcess = spawnProcess(piCommand.command, piCommand.args, {
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
      commandDisplay: "pi -p",
      complete() {
        const finalAssistantMessage = stdout.trim();

        return {
          finalAssistantMessage:
            finalAssistantMessage.length > 0 ? finalAssistantMessage : null,
        };
      },
      provider: "pi",
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
