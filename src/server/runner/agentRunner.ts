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
import { getPiJsonSpawnCommand } from "./piCommand.js";
import { PiJsonEventParser } from "./piJsonEvents.js";

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

type ParsedAgentJsonEvent = {
  events: RunEventPayload[];
  metadata: Partial<RunSummaryDetails>;
};

type AgentSpawnCommand = {
  args: string[];
  command: string;
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

    return startJsonAgentRun({
      command: codexCommand,
      commandDisplay: "codex exec",
      finalAssistantMessage: () =>
        readFinalMessageFile(settings.outputLastMessagePath),
      flushParser: () => parser.flush(),
      hooks,
      parseChunk: (chunk) => parser.push(chunk),
      provider: "codex",
      repositoryPath,
      spawnProcess,
    });
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

    return startJsonAgentRun({
      command: claudeCommand,
      commandDisplay: "claude -p --output-format stream-json",
      finalAssistantMessage: () => parser.getFinalAssistantMessage(),
      flushParser: () => parser.flush(),
      hooks,
      parseChunk: (chunk) => parser.push(chunk),
      provider: "claude",
      repositoryPath,
      spawnProcess,
    });
  },
};

const piRunner: AgentRunner = {
  provider: "pi",
  startRun({ hooks, prompt, repositoryPath, settings, spawnProcess }) {
    if (settings.provider !== "pi") {
      throw new Error("Pi runner received non-Pi settings.");
    }

    const parser = new PiJsonEventParser();
    const piCommand = getPiJsonSpawnCommand(prompt, {
      model: settings.piModel,
    });

    return startJsonAgentRun({
      command: piCommand,
      commandDisplay: "pi --mode json",
      finalAssistantMessage: () => parser.getFinalAssistantMessage(),
      flushParser: () => parser.flush(),
      hooks,
      parseChunk: (chunk) => parser.push(chunk),
      provider: "pi",
      repositoryPath,
      spawnProcess,
    });
  },
};

function startJsonAgentRun(options: {
  command: AgentSpawnCommand;
  commandDisplay: string;
  finalAssistantMessage: () => string | null;
  flushParser: () => ParsedAgentJsonEvent;
  hooks: AgentRunHooks;
  parseChunk: (chunk: Buffer | string) => ParsedAgentJsonEvent;
  provider: AgentProvider;
  repositoryPath: string;
  spawnProcess: ProcessSpawner;
}): StartedAgentRun {
  const {
    command,
    commandDisplay,
    finalAssistantMessage,
    flushParser,
    hooks,
    parseChunk,
    provider,
    repositoryPath,
    spawnProcess,
  } = options;
  const childProcess = spawnProcess(command.command, command.args, {
    cwd: repositoryPath,
    windowsHide: true,
  });

  childProcess.stdout.on("data", (chunk: Buffer | string) => {
    hooks.onStdout(chunk);
    emitParsedAgentJsonEvent(parseChunk(chunk), hooks);
  });
  childProcess.stderr.on("data", hooks.onStderr);
  childProcess.stdin.end();

  return {
    childProcess,
    commandDisplay,
    complete() {
      emitParsedAgentJsonEvent(flushParser(), hooks);

      return {
        finalAssistantMessage: finalAssistantMessage(),
      };
    },
    provider,
  };
}

function emitParsedAgentJsonEvent(
  parsedEvent: ParsedAgentJsonEvent,
  hooks: AgentRunHooks,
): void {
  for (const event of parsedEvent.events) {
    hooks.onRunEvent(event);
  }

  hooks.onMetadata(parsedEvent.metadata);
}

function readFinalMessageFile(outputPath: string): string | null {
  if (!existsSync(outputPath)) {
    return null;
  }

  const finalMessage = readFileSync(outputPath, "utf8").trim();

  return finalMessage.length > 0 ? finalMessage : null;
}
