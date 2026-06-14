import path from "node:path";
import { writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

import {
  getClaudeStreamJsonSpawnCommand,
  getCodexExecSpawnCommand,
  getPiJsonSpawnCommand,
} from "../../../src/server/index";
import {
  appendLogEntriesToTranscript,
  appendRawLogEntries,
  appendRunEventsToTranscript,
  type LogEntry,
  type LogsEvent,
  type RunEventsEvent,
  type RunProgressEvent,
  type RunSummaryDetails,
  type RuntimeTranscriptEntry,
} from "../../../src/web/events/runtimeStream";
import { createTestServer, listenOnRandomPort, trackTestServer } from "../helpers/fastify";
import { createMockRunProcess } from "../helpers/process";
import { browseRepository } from "../helpers/repositoryBrowse";
import { createRepositoryPath } from "../helpers/tempRepository";
import {
  parseSsePayloads,
  readSseChunk,
  readSseSnapshot,
  readUntilSsePayloads,
} from "../helpers/sse";
import { useServerTestLifecycle } from "../helpers/lifecycle";

useServerTestLifecycle();

type NamedSsePayload = {
  event: string;
  payload: unknown;
};

function parseNamedSsePayloads(text: string): NamedSsePayload[] {
  return text
    .trim()
    .split("\n\n")
    .filter((block) => block.trim().length > 0)
    .map((block) => {
      const eventLine = block.split("\n").find((line) => line.startsWith("event: "));
      const dataLine = block.split("\n").find((line) => line.startsWith("data: "));

      if (!eventLine || !dataLine) {
        throw new Error(`Malformed SSE block: ${block}`);
      }

      return {
        event: eventLine.slice("event: ".length),
        payload: JSON.parse(dataLine.slice("data: ".length)) as unknown,
      };
    });
}

async function readUntilNamedSsePayloads(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  isComplete: (payloads: NamedSsePayload[]) => boolean,
): Promise<NamedSsePayload[]> {
  let text = "";

  for (let attempt = 0; attempt < 20; attempt += 1) {
    text += await readSseChunk(reader);

    const payloads = parseNamedSsePayloads(text);

    if (isComplete(payloads)) {
      return payloads;
    }
  }

  throw new Error("SSE stream did not send the expected payload sequence.");
}

function getNamedPayloads(
  payloads: NamedSsePayload[],
  eventName: string,
): unknown[] {
  return payloads
    .filter((payload) => payload.event === eventName)
    .map((payload) => payload.payload);
}

function getRunEventEntries(payloads: NamedSsePayload[]): RunEventsEvent["entries"] {
  return getNamedPayloads(payloads, "runEvents").flatMap(
    (payload) => (payload as RunEventsEvent).entries,
  );
}

function getLastRunDetails(payloads: NamedSsePayload[]) {
  return getNamedPayloads(payloads, "runDetails").at(-1);
}

function expectSseEventsInOrder(
  payloads: NamedSsePayload[],
  expectedEvents: string[],
): void {
  let expectedIndex = 0;

  for (const payload of payloads) {
    if (payload.event === expectedEvents[expectedIndex]) {
      expectedIndex += 1;
    }
  }

  expect(expectedIndex).toBe(expectedEvents.length);
}

function createTranscriptFromSsePayloads(
  payloads: NamedSsePayload[],
): {
  rawLogs: LogEntry[];
  transcript: RuntimeTranscriptEntry[];
} {
  let progress: RunProgressEvent = {
    currentRun: 1,
    totalRuns: 1,
  };
  let rawLogs: LogEntry[] = [];
  let transcript: RuntimeTranscriptEntry[] = [];

  for (const namedPayload of payloads) {
    if (namedPayload.event === "progress") {
      progress = namedPayload.payload as RunProgressEvent;
    }

    if (namedPayload.event === "logs") {
      const entries = (namedPayload.payload as LogsEvent).entries;
      rawLogs = appendRawLogEntries(rawLogs, entries);
      transcript = appendLogEntriesToTranscript(transcript, entries, progress, 100);
    }

    if (namedPayload.event === "runEvents") {
      transcript = appendRunEventsToTranscript(
        transcript,
        (namedPayload.payload as RunEventsEvent).entries,
      );
    }
  }

  return {
    rawLogs,
    transcript,
  };
}

describe("run start endpoint", () => {
  it("requires a selected repository", async () => {
    const app = await createTestServer();

    const response = await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "No repository selected.",
    });
  });

  it.each([
    ["missing request body", undefined, "request", "Required"],
    ["missing prompt", { runCount: 1 }, "prompt", "Required"],
    ["empty prompt", { prompt: "   ", runCount: 1 }, "prompt", "Prompt is required."],
    [
      "missing run count",
      { prompt: "Use goal.md as the source of truth." },
      "runCount",
      "Run count is required.",
    ],
    [
      "fractional run count",
      { prompt: "Use goal.md as the source of truth.", runCount: 1.5 },
      "runCount",
      "Run count must be a whole number.",
    ],
    [
      "zero run count",
      { prompt: "Use goal.md as the source of truth.", runCount: 0 },
      "runCount",
      "Run count must be at least 1.",
    ],
    [
      "run count above maximum",
      { prompt: "Use goal.md as the source of truth.", runCount: 101 },
      "runCount",
      "Run count must be at most 100.",
    ],
    [
      "non-array verification commands",
      {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        verificationCommands: "npm test",
      },
      "verificationCommands",
      "Verification commands must be an array.",
    ],
    [
      "non-string verification command",
      {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        verificationCommands: [["npm", "test"]],
      },
      "verificationCommands.0",
      "Verification command must be a string.",
    ],
    [
      "non-boolean auto-commit toggle",
      {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        autoCommit: "yes",
      },
      "autoCommit",
      "Auto-commit toggle must be a boolean.",
    ],
    [
      "invalid model",
      {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        model: "gpt-4",
      },
      "model",
      "Invalid enum value. Expected 'gpt-5.5' | 'gpt-5.4' | 'gpt-5.4-mini' | 'gpt-5.4-nano' | 'gpt-5.3-codex', received 'gpt-4'",
    ],
    [
      "invalid reasoning effort",
      {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        reasoningEffort: "extreme",
      },
      "reasoningEffort",
      "Invalid enum value. Expected 'low' | 'medium' | 'high' | 'xhigh', received 'extreme'",
    ],
    [
      "invalid Claude model",
      {
        provider: "claude",
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        claudeModel: "claude-unknown",
      },
      "claudeModel",
      "Invalid enum value. Expected 'sonnet' | 'opus', received 'claude-unknown'",
    ],
    [
      "unsupported Claude effort",
      {
        provider: "claude",
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        claudeEffort: "ultracode",
      },
      "request",
      "Unrecognized key(s) in object: 'claudeEffort'",
    ],
    [
      "review without auto-commit",
      {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        autoCommit: false,
        review: {
          enabled: true,
          intervalCommits: 3,
          prompt: "Review recent commits.",
        },
      },
      "review",
      "Review requires auto-commit to be enabled.",
    ],
    [
      "empty review prompt",
      {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        autoCommit: true,
        review: {
          enabled: true,
          intervalCommits: 3,
          prompt: "   ",
        },
      },
      "review.prompt",
      "Review prompt is required.",
    ],
    [
      "zero review interval",
      {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        autoCommit: true,
        review: {
          enabled: true,
          intervalCommits: 0,
          prompt: "Review recent commits.",
        },
      },
      "review.intervalCommits",
      "Review interval must be at least 1.",
    ],
    [
      "invalid review model",
      {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        autoCommit: true,
        review: {
          enabled: true,
          intervalCommits: 3,
          prompt: "Review recent commits.",
          model: "gpt-4",
        },
      },
      "review.model",
      "Invalid enum value. Expected 'gpt-5.5' | 'gpt-5.4' | 'gpt-5.4-mini' | 'gpt-5.4-nano' | 'gpt-5.3-codex', received 'gpt-4'",
    ],
    [
      "invalid review reasoning effort",
      {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        autoCommit: true,
        review: {
          enabled: true,
          intervalCommits: 3,
          prompt: "Review recent commits.",
          reasoningEffort: "extreme",
        },
      },
      "review.reasoningEffort",
      "Invalid enum value. Expected 'low' | 'medium' | 'high' | 'xhigh', received 'extreme'",
    ],
    [
      "Pi model with Codex provider",
      {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        piModel: "local-llama",
      },
      "piModel",
      "Pi model is only supported when provider is pi.",
    ],
    [
      "verification command with shell operator",
      {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        verificationCommands: ["npm test && npm run build"],
      },
      "verificationCommands.0",
      "Verification command must use a single executable plus arguments; shell operators are not supported.",
    ],
    [
      "verification command with unterminated quote",
      {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        verificationCommands: ['npm test -- --testNamePattern "run loop'],
      },
      "verificationCommands.0",
      "Verification command contains an unterminated quoted argument.",
    ],
    [
      "verification command through a shell",
      {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        verificationCommands: ["powershell -Command npm test"],
      },
      "verificationCommands.0",
      "Verification command must be a direct executable, not a shell.",
    ],
    [
      "legacy verification command field",
      {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        verificationCommand: "npm test",
      },
      "request",
      "Unrecognized key(s) in object: 'verificationCommand'",
    ],
    [
      "extra fields",
      {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        planFile: "refactor.md",
      },
      "request",
      "Unrecognized key(s) in object: 'planFile'",
    ],
  ])(
    "rejects an invalid payload with frontend-ready issues: %s",
    async (_name, payload, issuePath, issueMessage) => {
      const repositoryPath = await createRepositoryPath();
      const app = await createTestServer();

      await browseRepository(app, repositoryPath);

      const response = await app.inject({
        method: "POST",
        url: "/api/run/start",
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: "Invalid run start request.",
        code: "VALIDATION_ERROR",
      });
      expect(response.json().issues).toEqual(
        expect.arrayContaining([
          {
            path: issuePath,
            message: issueMessage,
          },
        ]),
      );
    },
  );

  it("rejects an invalid verification command before spawning a run", async () => {
    const repositoryPath = await createRepositoryPath();
    const spawnProcess = vi.fn(() => createMockRunProcess());
    const app = await createTestServer({
      spawnProcess,
    });
    trackTestServer(app);

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        verificationCommands: ["npm test | tee test.log"],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "Invalid run start request.",
      code: "VALIDATION_ERROR",
    });
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("accepts a valid run start request and marks the run active", async () => {
    const repositoryPath = await createRepositoryPath();
    const app = await createTestServer();

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "  Use goal.md as the source of truth.  ",
        runCount: 2,
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      status: "running",
      repositoryPath: path.normalize(repositoryPath),
      provider: "codex",
      prompt: "Use goal.md as the source of truth.",
      runCount: 2,
      verificationCommands: [],
      autoCommit: false,
      model: null,
      reasoningEffort: null,
      claudeModel: null,
      piModel: null,
      review: {
        enabled: false,
        provider: "codex",
        intervalCommits: 3,
        prompt: "",
        model: null,
        reasoningEffort: null,
        claudeModel: null,
        piModel: null,
      },
    });
  });

  it("accepts an explicit auto-commit toggle", async () => {
    const repositoryPath = await createRepositoryPath();
    const app = await createTestServer();

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        autoCommit: true,
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      status: "running",
      repositoryPath: path.normalize(repositoryPath),
      prompt: "Use goal.md as the source of truth.",
      runCount: 1,
      verificationCommands: [],
      autoCommit: true,
      model: null,
      reasoningEffort: null,
      review: {
        enabled: false,
        intervalCommits: 3,
        prompt: "",
        model: null,
        reasoningEffort: null,
      },
    });
  });

  it("accepts enabled review settings when auto-commit is enabled", async () => {
    const repositoryPath = await createRepositoryPath();
    const app = await createTestServer();

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        autoCommit: true,
        review: {
          enabled: true,
          intervalCommits: 3,
          prompt: "  Review recent commits.  ",
          model: "gpt-5.4-mini",
          reasoningEffort: "medium",
        },
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      autoCommit: true,
      review: {
        enabled: true,
        intervalCommits: 3,
        prompt: "Review recent commits.",
        model: "gpt-5.4-mini",
        reasoningEffort: "medium",
      },
    });
  });

  it("accepts explicit model and reasoning effort selections", async () => {
    const repositoryPath = await createRepositoryPath();
    const runProcess = createMockRunProcess();
    const spawnProcess = vi.fn(() => runProcess);
    const app = await createTestServer({
      spawnProcess,
    });
    trackTestServer(app);

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        model: "gpt-5.4-nano",
        reasoningEffort: "low",
      },
    });
    const expectedCodexCommand = getCodexExecSpawnCommand(
      "Use goal.md as the source of truth.",
      {
        model: "gpt-5.4-nano",
        reasoningEffort: "low",
      },
    );

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      status: "running",
      repositoryPath: path.normalize(repositoryPath),
      prompt: "Use goal.md as the source of truth.",
      runCount: 1,
      verificationCommands: [],
      autoCommit: false,
      model: "gpt-5.4-nano",
      reasoningEffort: "low",
      review: {
        enabled: false,
        intervalCommits: 3,
        prompt: "",
        model: null,
        reasoningEffort: null,
      },
    });
    expect(spawnProcess).toHaveBeenCalledWith(
      expectedCodexCommand.command,
      expect.arrayContaining([
        "exec",
        "--json",
        "--output-last-message",
        "--model",
        "gpt-5.4-nano",
        "-c",
        "model_reasoning_effort=low",
        "Use goal.md as the source of truth.",
      ]),
      {
        cwd: path.normalize(repositoryPath),
        windowsHide: true,
      },
    );
  });

  it("transitions from idle to running when a run starts", async () => {
    const repositoryPath = await createRepositoryPath();
    const runProcess = createMockRunProcess(456);
    const app = await createTestServer({
      spawnProcess: vi.fn(() => runProcess),
    });
    trackTestServer(app);
    const origin = await listenOnRandomPort(app);

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 2,
      },
    });
    const snapshotChunk = await readSseSnapshot(origin);

    expect(response.statusCode).toBe(202);
    expect(parseSsePayloads(snapshotChunk, "status")).toEqual([
      {
        status: "running",
        selectedRepositoryPath: path.normalize(repositoryPath),
      },
    ]);
    expect(parseSsePayloads(snapshotChunk, "progress")).toEqual([
      {
        currentRun: 1,
        totalRuns: 2,
      },
    ]);
    expect(parseSsePayloads(snapshotChunk, "summary")).toEqual([
      {
        status: "running",
        message: "Started Codex run 1 of 2.",
      },
    ]);
  });

  it("transitions from running to complete after the final successful run", async () => {
    const repositoryPath = await createRepositoryPath();
    const goalMarkdown = "# Selected Goal\n\n- [ ] Next step\n";
    await writeFile(path.join(repositoryPath, "goal.md"), goalMarkdown);
    const runProcess = createMockRunProcess();
    const app = await createTestServer({
      spawnProcess: vi.fn(() => runProcess),
    });
    trackTestServer(app);
    const origin = await listenOnRandomPort(app);
    const response = await globalThis.fetch(`${origin}/api/events`);
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error("Missing SSE response body.");
    }

    await readSseChunk(reader);

    await browseRepository(app, repositoryPath);
    await readSseChunk(reader);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
      },
    });
    await readUntilSsePayloads(reader, "summary");

    runProcess.emit("close", 0, null);
    await readUntilSsePayloads(reader, "summary");
    await reader.cancel();

    const snapshotChunk = await readSseSnapshot(origin);
    const stopResponse = await app.inject({
      method: "POST",
      url: "/api/run/stop",
    });

    expect(parseSsePayloads(snapshotChunk, "status")).toEqual([
      {
        status: "complete",
        selectedRepositoryPath: path.normalize(repositoryPath),
      },
    ]);
    expect(parseSsePayloads(snapshotChunk, "progress")).toEqual([
      {
        currentRun: 1,
        totalRuns: 1,
      },
    ]);
    expect(parseSsePayloads(snapshotChunk, "summary")).toEqual([
      {
        status: "complete",
        message: `Completed Codex run 1 of 1 and refreshed goal.md (${goalMarkdown.length} characters).`,
      },
    ]);
    expect(stopResponse.statusCode).toBe(409);
    expect(stopResponse.json()).toEqual({
      error: "No active run to stop.",
    });
  });

  it.each([
    ["empty verification command", ["   "], []],
    [
      "single verification command with arguments",
      ["  npm test -- --runInBand  "],
      ["npm test -- --runInBand"],
    ],
    [
      "quoted verification argument",
      ['  npm test -- --testNamePattern "run loop"  '],
      ['npm test -- --testNamePattern "run loop"'],
    ],
    [
      "multiple verification commands",
      ["  npm test  ", "", "  npm run lint  "],
      ["npm test", "npm run lint"],
    ],
  ])("accepts optional %s", async (_name, verificationCommands, expected) => {
    const repositoryPath = await createRepositoryPath();
    const app = await createTestServer();

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        verificationCommands,
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      status: "running",
      repositoryPath: path.normalize(repositoryPath),
      prompt: "Use goal.md as the source of truth.",
      runCount: 1,
      verificationCommands: expected,
      autoCommit: false,
      model: null,
      reasoningEffort: null,
      review: {
        enabled: false,
        intervalCommits: 3,
        prompt: "",
        model: null,
        reasoningEffort: null,
      },
    });
  });

  it("spawns codex exec in the selected repository for the first run", async () => {
    const repositoryPath = await createRepositoryPath();
    const runProcess = createMockRunProcess();
    const spawnProcess = vi.fn(() => runProcess);
    const app = await createTestServer({
      spawnProcess,
    });
    trackTestServer(app);

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "  Use goal.md as the source of truth.  ",
        runCount: 2,
      },
    });
    const expectedCodexCommand = getCodexExecSpawnCommand(
      "Use goal.md as the source of truth.",
    );

    expect(response.statusCode).toBe(202);
    expect(spawnProcess).toHaveBeenCalledWith(
      expectedCodexCommand.command,
      expect.arrayContaining([
        "exec",
        "--json",
        "--output-last-message",
        "Use goal.md as the source of truth.",
      ]),
      {
        cwd: path.normalize(repositoryPath),
        windowsHide: true,
      },
    );
    expect(runProcess.stdin.writableEnded).toBe(true);
  });

  it("spawns claude streaming JSON in the selected repository with model", async () => {
    const repositoryPath = await createRepositoryPath();
    const runProcess = createMockRunProcess();
    const spawnProcess = vi.fn(() => runProcess);
    const app = await createTestServer({
      spawnProcess,
    });
    trackTestServer(app);

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        provider: "claude",
        prompt: "  Use goal.md as the source of truth.  ",
        runCount: 1,
        claudeModel: "opus",
      },
    });
    const expectedClaudeCommand = getClaudeStreamJsonSpawnCommand(
      "Use goal.md as the source of truth.",
      {
        model: "opus",
      },
    );

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      provider: "claude",
      model: null,
      reasoningEffort: null,
      claudeModel: "opus",
    });
    expect(spawnProcess).toHaveBeenCalledWith(
      expectedClaudeCommand.command,
      expectedClaudeCommand.args,
      {
        cwd: path.normalize(repositoryPath),
        windowsHide: true,
      },
    );
    expect(runProcess.stdin.writableEnded).toBe(true);
  });

  it("spawns pi JSON mode in the selected repository with model", async () => {
    const repositoryPath = await createRepositoryPath();
    const runProcess = createMockRunProcess();
    const spawnProcess = vi.fn(() => runProcess);
    const app = await createTestServer({
      spawnProcess,
    });
    trackTestServer(app);

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        provider: "pi",
        prompt: "  Use goal.md as the source of truth.  ",
        runCount: 1,
        piModel: "  local-llama  ",
      },
    });
    const expectedPiCommand = getPiJsonSpawnCommand(
      "Use goal.md as the source of truth.",
      {
        model: "local-llama",
      },
    );

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      provider: "pi",
      model: null,
      reasoningEffort: null,
      claudeModel: null,
      piModel: "local-llama",
    });
    expect(spawnProcess).toHaveBeenCalledWith(
      expectedPiCommand.command,
      expectedPiCommand.args,
      {
        cwd: path.normalize(repositoryPath),
        windowsHide: true,
      },
    );
    expect(runProcess.stdin.writableEnded).toBe(true);
  });

  it("rejects Codex settings when provider is Claude", async () => {
    const repositoryPath = await createRepositoryPath();
    const spawnProcess = vi.fn(() => createMockRunProcess());
    const app = await createTestServer({
      spawnProcess,
    });
    trackTestServer(app);

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        provider: "claude",
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        model: "gpt-5.4",
        reasoningEffort: "high",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().issues).toEqual(
      expect.arrayContaining([
        {
          path: "model",
          message: "Codex model is only supported when provider is codex.",
        },
        {
          path: "reasoningEffort",
          message:
            "Codex reasoning effort is only supported when provider is codex.",
        },
      ]),
    );
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("rejects Codex and Claude settings when provider is Pi", async () => {
    const repositoryPath = await createRepositoryPath();
    const spawnProcess = vi.fn(() => createMockRunProcess());
    const app = await createTestServer({
      spawnProcess,
    });
    trackTestServer(app);

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        provider: "pi",
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        model: "gpt-5.4",
        reasoningEffort: "high",
        claudeModel: "opus",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().issues).toEqual(
      expect.arrayContaining([
        {
          path: "model",
          message: "Codex model is only supported when provider is codex.",
        },
        {
          path: "reasoningEffort",
          message:
            "Codex reasoning effort is only supported when provider is codex.",
        },
        {
          path: "claudeModel",
          message: "Claude model is only supported when provider is claude.",
        },
      ]),
    );
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("rejects Pi review model when review provider is Codex", async () => {
    const repositoryPath = await createRepositoryPath();
    const spawnProcess = vi.fn(() => createMockRunProcess());
    const app = await createTestServer({
      spawnProcess,
    });
    trackTestServer(app);

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        autoCommit: true,
        review: {
          enabled: true,
          provider: "codex",
          intervalCommits: 1,
          prompt: "Review recent commits.",
          piModel: "local-llama",
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().issues).toEqual(
      expect.arrayContaining([
        {
          path: "review.piModel",
          message: "Pi model is only supported when provider is pi.",
        },
      ]),
    );
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("fails the run with a clear message when Claude Code is missing", async () => {
    const repositoryPath = await createRepositoryPath();
    const runProcess = createMockRunProcess();
    const app = await createTestServer({
      spawnProcess: vi.fn(() => runProcess),
    });
    trackTestServer(app);
    const origin = await listenOnRandomPort(app);
    const response = await globalThis.fetch(`${origin}/api/events`);
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error("Missing SSE response body.");
    }

    await readSseChunk(reader);

    await browseRepository(app, repositoryPath);
    await readSseChunk(reader);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        provider: "claude",
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
      },
    });
    await readUntilSsePayloads(reader, "summary");

    runProcess.emit(
      "error",
      Object.assign(new Error("spawn claude ENOENT"), {
        code: "ENOENT",
      }),
    );
    const summaryPayloads = await readUntilSsePayloads(reader, "summary");
    await reader.cancel();

    expect(summaryPayloads).toEqual([
      {
        status: "failed",
        message: "Claude Code is not installed or is not available on PATH.",
      },
    ]);
  });

  it("fails the run when Codex cannot be started", async () => {
    const repositoryPath = await createRepositoryPath();
    const runProcess = createMockRunProcess();
    const app = await createTestServer({
      spawnProcess: vi.fn(() => runProcess),
    });
    trackTestServer(app);
    const origin = await listenOnRandomPort(app);
    const response = await globalThis.fetch(`${origin}/api/events`);
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error("Missing SSE response body.");
    }

    await readSseChunk(reader);

    await browseRepository(app, repositoryPath);
    await readSseChunk(reader);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
      },
    });
    await readUntilSsePayloads(reader, "summary");

    runProcess.emit("error", new Error("spawn codex ENOENT"));
    const summaryPayloads = await readUntilSsePayloads(reader, "summary");
    await reader.cancel();

    expect(summaryPayloads).toEqual([
      {
        status: "failed",
        message:
          "Failed to start Codex run 1; ensure the Codex CLI is installed and available on PATH.",
      },
    ]);
  });

  it("streams Codex stdout and stderr to connected SSE clients", async () => {
    const repositoryPath = await createRepositoryPath();
    const runProcess = createMockRunProcess();
    const app = await createTestServer({
      spawnProcess: vi.fn(() => runProcess),
    });
    trackTestServer(app);
    const origin = await listenOnRandomPort(app);

    const response = await globalThis.fetch(`${origin}/api/events`);
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error("Missing SSE response body.");
    }

    await readSseChunk(reader);

    await browseRepository(app, repositoryPath);
    await readSseChunk(reader);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
      },
    });
    await readSseChunk(reader);

    runProcess.stdout.write("stdout line\n");
    const stdoutPayloads = await readUntilSsePayloads(reader, "logs");

    runProcess.stderr.write("stderr line\n");
    const stderrPayloads = await readUntilSsePayloads(reader, "logs");
    await reader.cancel();

    expect(stdoutPayloads).toEqual([
      {
        entries: [
          {
            id: 1,
            stream: "stdout",
            message: "stdout line\n",
          },
        ],
      },
    ]);
    expect(stderrPayloads).toEqual([
      {
        entries: [
          {
            id: 2,
            stream: "stderr",
            message: "stderr line\n",
          },
        ],
      },
    ]);
  });

  it("runs a mocked Codex JSONL stream through SSE in raw log, run event, detail, and transcript order", async () => {
    const repositoryPath = await createRepositoryPath();
    const goalMarkdown = "# Goal\n\n- [ ] Next\n";
    await writeFile(path.join(repositoryPath, "goal.md"), goalMarkdown);
    const runProcess = createMockRunProcess();
    const app = await createTestServer({
      spawnProcess: vi.fn(() => runProcess),
    });
    trackTestServer(app);
    const origin = await listenOnRandomPort(app);

    const response = await globalThis.fetch(`${origin}/api/events`);
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error("Missing SSE response body.");
    }

    await readSseChunk(reader);

    await browseRepository(app, repositoryPath);
    await readSseChunk(reader);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
      },
    });
    await readUntilSsePayloads(reader, "summary");

    const codexJsonl = [
      JSON.stringify({
        type: "turn.started",
      }),
      JSON.stringify({
        type: "item.started",
        item: {
          type: "command_execution",
          command: "npm test",
        },
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "command_execution",
          command: "npm test",
          exit_code: 0,
          status: "completed",
        },
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "file_change",
          status: "completed",
          changes: [
            {
              path: "src/web/App.tsx",
            },
          ],
        },
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "agent_message",
          text: "Codex final answer",
        },
        usage: {
          input_tokens: 2,
          output_tokens: 3,
        },
        stop_reason: "end_turn",
      }),
    ].join("\n") + "\n";

    runProcess.stdout.write(codexJsonl);
    const livePayloads = await readUntilNamedSsePayloads(reader, (payloads) => {
      const runEvents = getRunEventEntries(payloads);
      const runDetails = getLastRunDetails(payloads) as RunSummaryDetails | undefined;

      return (
        runEvents.some(
          (event) =>
            event.kind === "final_assistant_message" &&
            event.message === "Codex final answer",
        ) &&
        runDetails?.lastAssistantMessage === "Codex final answer" &&
        runDetails?.changedFiles.includes("src/web/App.tsx") === true &&
        runDetails?.tokenCount === 5 &&
        runDetails?.stopReason === "end_turn"
      );
    });

    expectSseEventsInOrder(livePayloads, ["logs", "runEvents", "runDetails"]);
    expect((getNamedPayloads(livePayloads, "logs")[0] as LogsEvent)).toEqual({
      entries: [
        {
          id: 1,
          stream: "stdout",
          message: codexJsonl,
        },
      ],
    });
    expect(getRunEventEntries(livePayloads).map((event) => event.kind)).toEqual([
      "run_started",
      "agent_session_started",
      "command_started",
      "command_succeeded",
      "patch_applied",
      "final_assistant_message",
    ]);

    runProcess.emit("close", 0, null);
    const completePayloads = await readUntilNamedSsePayloads(reader, (payloads) =>
      getRunEventEntries(payloads).some(
        (event) =>
          event.kind === "run_completed" &&
          event.message ===
            `Completed Codex run 1 of 1 and refreshed goal.md (${goalMarkdown.length} characters).`,
      ),
    );
    await reader.cancel();

    const { rawLogs, transcript } = createTranscriptFromSsePayloads([
      ...livePayloads,
      ...completePayloads,
    ]);

    expect(rawLogs).toEqual([
      {
        id: 1,
        stream: "stdout",
        message: codexJsonl,
      },
    ]);
    expect(transcript.map((entry) => entry.message)).toEqual([
      "Started Codex run 1 of 1.",
      "Codex turn started.",
      "Command started: npm test",
      "Command succeeded: npm test",
      "Patch applied. src/web/App.tsx",
      "Codex final answer",
      `Completed Codex run 1 of 1 and refreshed goal.md (${goalMarkdown.length} characters).`,
    ]);
  });

  it("runs a mocked Claude JSONL stream through SSE with live activity before process close", async () => {
    const repositoryPath = await createRepositoryPath();
    const goalMarkdown = "# Goal\n\n- [ ] Next\n";
    await writeFile(path.join(repositoryPath, "goal.md"), goalMarkdown);
    const runProcess = createMockRunProcess();
    const app = await createTestServer({
      spawnProcess: vi.fn(() => runProcess),
    });
    trackTestServer(app);
    const origin = await listenOnRandomPort(app);

    const response = await globalThis.fetch(`${origin}/api/events`);
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error("Missing SSE response body.");
    }

    await readSseChunk(reader);

    await browseRepository(app, repositoryPath);
    await readSseChunk(reader);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        provider: "claude",
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        claudeModel: "sonnet",
      },
    });
    await readUntilSsePayloads(reader, "summary");

    const claudeJsonl = [
      JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "claude-session",
        model: "claude-sonnet-4-5",
      }),
      JSON.stringify({
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
      }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "Claude final answer",
        usage: {
          input_tokens: 4,
          output_tokens: 6,
        },
      }),
    ].join("\n") + "\n";

    runProcess.stdout.write(claudeJsonl);
    const livePayloads = await readUntilNamedSsePayloads(reader, (payloads) => {
      const runEvents = getRunEventEntries(payloads);
      const runDetails = getLastRunDetails(payloads) as RunSummaryDetails | undefined;

      return (
        runEvents.some(
          (event) =>
            event.kind === "command_started" && event.command === "npm test",
        ) &&
        runEvents.some(
          (event) =>
            event.kind === "final_assistant_message" &&
            event.message === "Claude final answer",
        ) &&
        !runEvents.some((event) => event.kind === "run_completed") &&
        runDetails?.lastAssistantMessage === "Claude final answer" &&
        runDetails?.model === "claude-sonnet-4-5" &&
        runDetails?.tokenCount === 10
      );
    });

    expectSseEventsInOrder(livePayloads, ["logs", "runEvents", "runDetails"]);
    expect(getRunEventEntries(livePayloads)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "agent_session_started",
          message: "Claude session started: claude-session",
        }),
        expect.objectContaining({
          command: "npm test",
          kind: "command_started",
        }),
        expect.objectContaining({
          kind: "final_assistant_message",
          message: "Claude final answer",
        }),
      ]),
    );

    runProcess.emit("close", 0, null);
    const completePayloads = await readUntilNamedSsePayloads(reader, (payloads) =>
      getRunEventEntries(payloads).some((event) => event.kind === "run_completed"),
    );
    await reader.cancel();

    const { rawLogs, transcript } = createTranscriptFromSsePayloads([
      ...livePayloads,
      ...completePayloads,
    ]);

    expect(rawLogs[0]).toMatchObject({
      stream: "stdout",
      message: claudeJsonl,
    });
    expect(transcript.map((entry) => entry.message)).toEqual([
      "Started Claude run 1 of 1.",
      "Claude session started: claude-session",
      "Command started: npm test",
      "Claude final answer",
      `Completed Claude run 1 of 1 and refreshed goal.md (${goalMarkdown.length} characters).`,
    ]);
  });

  it("runs a mocked Pi JSONL stream through SSE with live activity before process close", async () => {
    const repositoryPath = await createRepositoryPath();
    const goalMarkdown = "# Goal\n\n- [ ] Next\n";
    await writeFile(path.join(repositoryPath, "goal.md"), goalMarkdown);
    const runProcess = createMockRunProcess();
    const app = await createTestServer({
      spawnProcess: vi.fn(() => runProcess),
    });
    trackTestServer(app);
    const origin = await listenOnRandomPort(app);

    const response = await globalThis.fetch(`${origin}/api/events`);
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error("Missing SSE response body.");
    }

    await readSseChunk(reader);

    await browseRepository(app, repositoryPath);
    await readSseChunk(reader);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        provider: "pi",
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        piModel: "local-llama",
      },
    });
    await readUntilSsePayloads(reader, "summary");

    const piJsonl = [
      JSON.stringify({
        type: "session",
        id: "pi-session",
        model: "local-llama-v2",
      }),
      JSON.stringify({
        type: "tool_execution_start",
        toolCallId: "tool-1",
        toolName: "write",
        args: {
          path: "src/web/App.tsx",
        },
      }),
      JSON.stringify({
        type: "tool_execution_end",
        toolCallId: "tool-1",
        toolName: "write",
        result: {
          path: "src/web/App.tsx",
          message: "Wrote src/web/App.tsx",
        },
        isError: false,
      }),
      JSON.stringify({
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
      }),
    ].join("\n") + "\n";

    runProcess.stdout.write(piJsonl);
    const livePayloads = await readUntilNamedSsePayloads(reader, (payloads) => {
      const runEvents = getRunEventEntries(payloads);
      const runDetails = getLastRunDetails(payloads) as RunSummaryDetails | undefined;

      return (
        runEvents.some(
          (event) =>
            event.kind === "tool_started" && event.toolName === "write",
        ) &&
        runEvents.some(
          (event) =>
            event.kind === "final_assistant_message" &&
            event.message === "Pi final answer",
        ) &&
        !runEvents.some((event) => event.kind === "run_completed") &&
        runDetails?.lastAssistantMessage === "Pi final answer" &&
        runDetails?.changedFiles.includes("src/web/App.tsx") === true &&
        runDetails?.model === "local-llama-v2" &&
        runDetails?.tokenCount === 7
      );
    });

    expectSseEventsInOrder(livePayloads, ["logs", "runEvents", "runDetails"]);
    expect(getRunEventEntries(livePayloads)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "agent_session_started",
          message: "Pi session started: pi-session",
        }),
        expect.objectContaining({
          kind: "tool_started",
          toolName: "write",
        }),
        expect.objectContaining({
          files: ["src/web/App.tsx"],
          kind: "patch_applied",
        }),
        expect.objectContaining({
          kind: "final_assistant_message",
          message: "Pi final answer",
        }),
      ]),
    );

    runProcess.emit("close", 0, null);
    const completePayloads = await readUntilNamedSsePayloads(reader, (payloads) =>
      getRunEventEntries(payloads).some((event) => event.kind === "run_completed"),
    );
    await reader.cancel();

    const { rawLogs, transcript } = createTranscriptFromSsePayloads([
      ...livePayloads,
      ...completePayloads,
    ]);

    expect(rawLogs[0]).toMatchObject({
      stream: "stdout",
      message: piJsonl,
    });
    expect(transcript.map((entry) => entry.message)).toEqual([
      "Started Pi run 1 of 1.",
      "Pi session started: pi-session",
      "Tool started: write (src/web/App.tsx)",
      "Tool succeeded: write (src/web/App.tsx)",
      "Patch applied. src/web/App.tsx",
      "Pi final answer",
      `Completed Pi run 1 of 1 and refreshed goal.md (${goalMarkdown.length} characters).`,
    ]);
  });

  it("stops immediately and reports failure when Codex exits with a non-zero code", async () => {
    const repositoryPath = await createRepositoryPath();
    const runProcess = createMockRunProcess();
    const app = await createTestServer({
      spawnProcess: vi.fn(() => runProcess),
    });
    trackTestServer(app);

    await browseRepository(app, repositoryPath);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 2,
      },
    });

    runProcess.emit("close", 7, null);

    const origin = await listenOnRandomPort(app);
    const response = await globalThis.fetch(`${origin}/api/events`);
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error("Missing SSE response body.");
    }

    const snapshotChunk = await readSseChunk(reader);
    await reader.cancel();

    expect(parseSsePayloads(snapshotChunk, "status")).toEqual([
      {
        status: "failed",
        selectedRepositoryPath: path.normalize(repositoryPath),
      },
    ]);
    expect(parseSsePayloads(snapshotChunk, "summary")).toEqual([
      {
        status: "failed",
        message: "Codex run 1 exited with code 7.",
      },
    ]);

    const restartResponse = await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
      },
    });

    expect(restartResponse.statusCode).toBe(202);
  });

  it("re-reads goal.md after a successful Codex run", async () => {
    const repositoryPath = await createRepositoryPath();
    const goalMarkdown = "# Selected Goal\n\n- [ ] Next step\n";
    await writeFile(path.join(repositoryPath, "goal.md"), goalMarkdown);
    const runProcess = createMockRunProcess();
    const app = await createTestServer({
      spawnProcess: vi.fn(() => runProcess),
    });
    trackTestServer(app);
    const origin = await listenOnRandomPort(app);

    const response = await globalThis.fetch(`${origin}/api/events`);
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error("Missing SSE response body.");
    }

    await readSseChunk(reader);

    await browseRepository(app, repositoryPath);
    await readSseChunk(reader);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
      },
    });
    await readUntilSsePayloads(reader, "summary");

    runProcess.emit("close", 0, null);
    const summaryPayloads = await readUntilSsePayloads(reader, "summary");
    await reader.cancel();

    expect(summaryPayloads).toEqual([
      {
        status: "complete",
        message: `Completed Codex run 1 of 1 and refreshed goal.md (${goalMarkdown.length} characters).`,
      },
    ]);
  });

  it("runs verification commands only after a successful Codex run in the selected repository", async () => {
    const repositoryPath = await createRepositoryPath();
    const goalMarkdown = "# Selected Goal\n\n- [ ] Next step\n";
    await writeFile(path.join(repositoryPath, "goal.md"), goalMarkdown);
    const runProcess = createMockRunProcess(321);
    const testVerificationProcess = createMockRunProcess(654);
    const lintVerificationProcess = createMockRunProcess(987);
    const spawnProcess = vi
      .fn()
      .mockReturnValueOnce(runProcess)
      .mockReturnValueOnce(testVerificationProcess)
      .mockReturnValueOnce(lintVerificationProcess);
    const app = await createTestServer({
      spawnProcess,
    });
    trackTestServer(app);
    const origin = await listenOnRandomPort(app);

    const response = await globalThis.fetch(`${origin}/api/events`);
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error("Missing SSE response body.");
    }

    await readSseChunk(reader);

    await browseRepository(app, repositoryPath);
    await readSseChunk(reader);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        verificationCommands: ["npm test -- --runInBand", "npm run lint"],
      },
    });
    await readUntilSsePayloads(reader, "summary");

    expect(spawnProcess).toHaveBeenCalledTimes(1);

    runProcess.emit("close", 0, null);
    const verificationSummaryPayloads = await readUntilSsePayloads(reader, "summary");

    expect(spawnProcess).toHaveBeenCalledTimes(2);
    expect(spawnProcess).toHaveBeenNthCalledWith(
      2,
      "npm",
      ["test", "--", "--runInBand"],
      {
        cwd: path.normalize(repositoryPath),
        windowsHide: true,
      },
    );
    expect(verificationSummaryPayloads).toEqual([
      {
        status: "running",
        message: "Started verification command 1 of 2 after Codex run 1 of 1.",
      },
    ]);

    testVerificationProcess.emit("close", 0, null);
    const secondVerificationSummaryPayloads = await readUntilSsePayloads(
      reader,
      "summary",
    );

    expect(spawnProcess).toHaveBeenCalledTimes(3);
    expect(spawnProcess).toHaveBeenNthCalledWith(3, "npm", ["run", "lint"], {
      cwd: path.normalize(repositoryPath),
      windowsHide: true,
    });
    expect(secondVerificationSummaryPayloads).toEqual([
      {
        status: "running",
        message: "Started verification command 2 of 2 after Codex run 1 of 1.",
      },
    ]);

    lintVerificationProcess.emit("close", 0, null);
    const completeSummaryPayloads = await readUntilSsePayloads(reader, "summary");
    await reader.cancel();

    expect(completeSummaryPayloads).toEqual([
      {
        status: "complete",
        message: `Completed Codex run 1 of 1 and refreshed goal.md (${goalMarkdown.length} characters).`,
      },
    ]);
  });

  it("runs auto-commit only after Codex and optional verification succeed", async () => {
    const repositoryPath = await createRepositoryPath();
    const goalMarkdown = "# Selected Goal\n\n- [ ] Next step\n";
    await writeFile(path.join(repositoryPath, "goal.md"), goalMarkdown);
    const runProcess = createMockRunProcess(321);
    const testVerificationProcess = createMockRunProcess(654);
    const lintVerificationProcess = createMockRunProcess(876);
    const gitAddProcess = createMockRunProcess(987);
    const gitStatusProcess = createMockRunProcess(765);
    const gitCommitProcess = createMockRunProcess(432);
    const spawnProcess = vi
      .fn()
      .mockReturnValueOnce(runProcess)
      .mockReturnValueOnce(testVerificationProcess)
      .mockReturnValueOnce(lintVerificationProcess)
      .mockReturnValueOnce(gitAddProcess)
      .mockReturnValueOnce(gitStatusProcess)
      .mockReturnValueOnce(gitCommitProcess);
    const app = await createTestServer({
      spawnProcess,
    });
    trackTestServer(app);
    const origin = await listenOnRandomPort(app);

    const response = await globalThis.fetch(`${origin}/api/events`);
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error("Missing SSE response body.");
    }

    await readSseChunk(reader);

    await browseRepository(app, repositoryPath);
    await readSseChunk(reader);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        verificationCommands: ["npm test", "npm run lint"],
        autoCommit: true,
      },
    });
    await readUntilSsePayloads(reader, "summary");

    runProcess.emit("close", 0, null);
    await readUntilSsePayloads(reader, "summary");

    expect(spawnProcess).toHaveBeenCalledTimes(2);

    testVerificationProcess.emit("close", 0, null);
    await readUntilSsePayloads(reader, "summary");

    expect(spawnProcess).toHaveBeenCalledTimes(3);

    lintVerificationProcess.emit("close", 0, null);
    const gitAddSummaryPayloads = await readUntilSsePayloads(reader, "summary");

    expect(spawnProcess).toHaveBeenCalledTimes(4);
    expect(spawnProcess).toHaveBeenNthCalledWith(4, "git", ["add", "-A"], {
      cwd: path.normalize(repositoryPath),
      windowsHide: true,
    });
    expect(gitAddSummaryPayloads).toEqual([
      {
        status: "running",
        message: "Started auto-commit staging after Codex run 1 of 1.",
      },
    ]);

    gitAddProcess.emit("close", 0, null);
    const gitStatusSummaryPayloads = await readUntilSsePayloads(reader, "summary");

    expect(spawnProcess).toHaveBeenCalledTimes(5);
    expect(spawnProcess).toHaveBeenNthCalledWith(
      5,
      "git",
      ["status", "--porcelain"],
      {
        cwd: path.normalize(repositoryPath),
        windowsHide: true,
      },
    );
    expect(gitStatusSummaryPayloads).toEqual([
      {
        status: "running",
        message: "Started auto-commit status check after Codex run 1 of 1.",
      },
    ]);

    gitStatusProcess.stdout.write(" M goal.md\n");
    gitStatusProcess.emit("close", 0, null);
    const gitCommitSummaryPayloads = await readUntilSsePayloads(reader, "summary");

    expect(spawnProcess).toHaveBeenCalledTimes(6);
    expect(spawnProcess).toHaveBeenNthCalledWith(
      6,
      "git",
      [
        "commit",
        "-m",
        "agent-goal-runner: apply Codex run 1 of 1",
        "-m",
        "Generated by agent-goal-runner after Codex and optional verification succeeded.",
      ],
      {
        cwd: path.normalize(repositoryPath),
        windowsHide: true,
      },
    );
    expect(gitCommitSummaryPayloads).toEqual([
      {
        status: "running",
        message: "Started auto-commit after Codex run 1 of 1.",
      },
    ]);

    gitCommitProcess.emit("close", 0, null);
    const completeSummaryPayloads = await readUntilSsePayloads(reader, "summary");
    await reader.cancel();

    expect(completeSummaryPayloads).toEqual([
      {
        status: "complete",
        message: `Completed Codex run 1 of 1 and refreshed goal.md (${goalMarkdown.length} characters).`,
      },
    ]);
  });

  it("streams git stdout and stderr to connected SSE clients during auto-commit", async () => {
    const repositoryPath = await createRepositoryPath();
    await writeFile(path.join(repositoryPath, "goal.md"), "# Selected Goal\n");
    const runProcess = createMockRunProcess(321);
    const gitAddProcess = createMockRunProcess(987);
    const gitStatusProcess = createMockRunProcess(765);
    const gitCommitProcess = createMockRunProcess(432);
    const spawnProcess = vi
      .fn()
      .mockReturnValueOnce(runProcess)
      .mockReturnValueOnce(gitAddProcess)
      .mockReturnValueOnce(gitStatusProcess)
      .mockReturnValueOnce(gitCommitProcess);
    const app = await createTestServer({
      spawnProcess,
    });
    trackTestServer(app);
    const origin = await listenOnRandomPort(app);

    const response = await globalThis.fetch(`${origin}/api/events`);
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error("Missing SSE response body.");
    }

    await readSseChunk(reader);

    await browseRepository(app, repositoryPath);
    await readSseChunk(reader);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        autoCommit: true,
      },
    });
    await readUntilSsePayloads(reader, "summary");

    runProcess.emit("close", 0, null);
    await readUntilSsePayloads(reader, "summary");

    gitAddProcess.emit("close", 0, null);
    await readUntilSsePayloads(reader, "summary");

    gitStatusProcess.stdout.write(" M goal.md\n");
    const gitStatusLogPayloads = await readUntilSsePayloads(reader, "logs");
    gitStatusProcess.emit("close", 0, null);
    await readUntilSsePayloads(reader, "summary");

    gitCommitProcess.stdout.write("[main 1234567] apply goal change\n");
    const gitCommitStdoutPayloads = await readUntilSsePayloads(reader, "logs");

    gitCommitProcess.stderr.write("git warning\n");
    const gitCommitStderrPayloads = await readUntilSsePayloads(reader, "logs");
    await reader.cancel();

    expect(gitStatusLogPayloads).toEqual([
      {
        entries: [
          {
            id: 1,
            stream: "stdout",
            message: " M goal.md\n",
          },
        ],
      },
    ]);
    expect(gitCommitStdoutPayloads).toEqual([
      {
        entries: [
          {
            id: 2,
            stream: "stdout",
            message: "[main 1234567] apply goal change\n",
          },
        ],
      },
    ]);
    expect(gitCommitStderrPayloads).toEqual([
      {
        entries: [
          {
            id: 3,
            stream: "stderr",
            message: "git warning\n",
          },
        ],
      },
    ]);
  });

  it("skips auto-commit when git status reports no changes", async () => {
    const repositoryPath = await createRepositoryPath();
    const goalMarkdown = "# Selected Goal\n\n- [ ] Next step\n";
    await writeFile(path.join(repositoryPath, "goal.md"), goalMarkdown);
    const runProcess = createMockRunProcess(321);
    const gitAddProcess = createMockRunProcess(987);
    const gitStatusProcess = createMockRunProcess(765);
    const spawnProcess = vi
      .fn()
      .mockReturnValueOnce(runProcess)
      .mockReturnValueOnce(gitAddProcess)
      .mockReturnValueOnce(gitStatusProcess);
    const app = await createTestServer({
      spawnProcess,
    });
    trackTestServer(app);
    const origin = await listenOnRandomPort(app);

    const response = await globalThis.fetch(`${origin}/api/events`);
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error("Missing SSE response body.");
    }

    await readSseChunk(reader);

    await browseRepository(app, repositoryPath);
    await readSseChunk(reader);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        autoCommit: true,
      },
    });
    await readUntilSsePayloads(reader, "summary");

    runProcess.emit("close", 0, null);
    const gitAddSummaryPayloads = await readUntilSsePayloads(reader, "summary");

    expect(spawnProcess).toHaveBeenCalledTimes(2);
    expect(spawnProcess).toHaveBeenNthCalledWith(2, "git", ["add", "-A"], {
      cwd: path.normalize(repositoryPath),
      windowsHide: true,
    });
    expect(gitAddSummaryPayloads).toEqual([
      {
        status: "running",
        message: "Started auto-commit staging after Codex run 1 of 1.",
      },
    ]);

    gitAddProcess.emit("close", 0, null);
    const gitStatusSummaryPayloads = await readUntilSsePayloads(reader, "summary");

    expect(spawnProcess).toHaveBeenCalledTimes(3);
    expect(spawnProcess).toHaveBeenNthCalledWith(
      3,
      "git",
      ["status", "--porcelain"],
      {
        cwd: path.normalize(repositoryPath),
        windowsHide: true,
      },
    );
    expect(gitStatusSummaryPayloads).toEqual([
      {
        status: "running",
        message: "Started auto-commit status check after Codex run 1 of 1.",
      },
    ]);

    gitStatusProcess.emit("close", 0, null);
    const skipSummaryPayloads = await readUntilSsePayloads(reader, "summary");
    const completeSummaryPayloads = await readUntilSsePayloads(reader, "summary");
    await reader.cancel();

    expect(spawnProcess).toHaveBeenCalledTimes(3);
    expect(skipSummaryPayloads).toEqual([
      {
        status: "running",
        message:
          "Skipped auto-commit after Codex run 1 of 1 because git status reported no changes.",
      },
    ]);
    expect(completeSummaryPayloads).toEqual([
      {
        status: "complete",
        message: `Completed Codex run 1 of 1 and refreshed goal.md (${goalMarkdown.length} characters).`,
      },
    ]);
  });

  it("stops the run loop when auto-commit fails", async () => {
    const repositoryPath = await createRepositoryPath();
    await writeFile(path.join(repositoryPath, "goal.md"), "# Selected Goal\n");
    const runProcess = createMockRunProcess(321);
    const gitAddProcess = createMockRunProcess(987);
    const gitStatusProcess = createMockRunProcess(765);
    const gitCommitProcess = createMockRunProcess(432);
    const nextRunProcess = createMockRunProcess(654);
    const spawnProcess = vi
      .fn()
      .mockReturnValueOnce(runProcess)
      .mockReturnValueOnce(gitAddProcess)
      .mockReturnValueOnce(gitStatusProcess)
      .mockReturnValueOnce(gitCommitProcess)
      .mockReturnValueOnce(nextRunProcess);
    const app = await createTestServer({
      spawnProcess,
    });
    trackTestServer(app);
    const origin = await listenOnRandomPort(app);

    const response = await globalThis.fetch(`${origin}/api/events`);
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error("Missing SSE response body.");
    }

    await readSseChunk(reader);

    await browseRepository(app, repositoryPath);
    await readSseChunk(reader);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 2,
        autoCommit: true,
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

    gitCommitProcess.emit("close", 1, null);
    await reader.cancel();
    await vi.waitFor(async () => {
      expect(parseSsePayloads(await readSseSnapshot(origin), "summary")).toEqual([
        {
          status: "failed",
          message: "Auto-commit after Codex run 1 exited with code 1.",
        },
      ]);
    });

    expect(spawnProcess).toHaveBeenCalledTimes(4);
  });

  it("streams verification stdout and stderr to connected SSE clients", async () => {
    const repositoryPath = await createRepositoryPath();
    await writeFile(path.join(repositoryPath, "goal.md"), "# Selected Goal\n");
    const runProcess = createMockRunProcess(321);
    const verificationProcess = createMockRunProcess(654);
    const spawnProcess = vi
      .fn()
      .mockReturnValueOnce(runProcess)
      .mockReturnValueOnce(verificationProcess);
    const app = await createTestServer({
      spawnProcess,
    });
    trackTestServer(app);
    const origin = await listenOnRandomPort(app);

    const response = await globalThis.fetch(`${origin}/api/events`);
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error("Missing SSE response body.");
    }

    await readSseChunk(reader);

    await browseRepository(app, repositoryPath);
    await readSseChunk(reader);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        verificationCommands: ["npm test"],
      },
    });
    await readUntilSsePayloads(reader, "summary");

    runProcess.emit("close", 0, null);
    await readUntilSsePayloads(reader, "summary");

    verificationProcess.stdout.write("verification stdout\n");
    const stdoutPayloads = await readUntilSsePayloads(reader, "logs");

    verificationProcess.stderr.write("verification stderr\n");
    const stderrPayloads = await readUntilSsePayloads(reader, "logs");
    await reader.cancel();

    expect(stdoutPayloads).toEqual([
      {
        entries: [
          {
            id: 1,
            stream: "stdout",
            message: "verification stdout\n",
          },
        ],
      },
    ]);
    expect(stderrPayloads).toEqual([
      {
        entries: [
          {
            id: 2,
            stream: "stderr",
            message: "verification stderr\n",
          },
        ],
      },
    ]);
  });

  it("stops the run loop when verification fails", async () => {
    const repositoryPath = await createRepositoryPath();
    await writeFile(path.join(repositoryPath, "goal.md"), "# Selected Goal\n");
    const runProcess = createMockRunProcess(321);
    const verificationProcess = createMockRunProcess(654);
    const nextRunProcess = createMockRunProcess(987);
    const spawnProcess = vi
      .fn()
      .mockReturnValueOnce(runProcess)
      .mockReturnValueOnce(verificationProcess)
      .mockReturnValueOnce(nextRunProcess);
    const app = await createTestServer({
      spawnProcess,
    });
    trackTestServer(app);
    const origin = await listenOnRandomPort(app);

    const response = await globalThis.fetch(`${origin}/api/events`);
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error("Missing SSE response body.");
    }

    await readSseChunk(reader);

    await browseRepository(app, repositoryPath);
    await readSseChunk(reader);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 2,
        verificationCommands: ["npm test", "npm run lint"],
        autoCommit: true,
      },
    });

    runProcess.emit("close", 0, null);
    await vi.waitFor(() => {
      expect(spawnProcess).toHaveBeenCalledTimes(2);
    });

    verificationProcess.emit("close", 1, null);
    await reader.cancel();
    await vi.waitFor(async () => {
      expect(parseSsePayloads(await readSseSnapshot(origin), "summary")).toEqual([
        {
          status: "failed",
          message: "Verification command 1 of 2 after Codex run 1 exited with code 1.",
        },
      ]);
    });

    expect(spawnProcess).toHaveBeenCalledTimes(2);
  });

  it("does not run verification after a failed Codex run", async () => {
    const repositoryPath = await createRepositoryPath();
    const runProcess = createMockRunProcess();
    const spawnProcess = vi.fn(() => runProcess);
    const app = await createTestServer({
      spawnProcess,
    });
    trackTestServer(app);

    await browseRepository(app, repositoryPath);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
        verificationCommands: ["npm test"],
      },
    });

    runProcess.emit("close", 7, null);
    await Promise.resolve();

    expect(spawnProcess).toHaveBeenCalledTimes(1);
  });

  it("continues with the next Codex run only when no stop condition is present", async () => {
    const repositoryPath = await createRepositoryPath();
    const goalMarkdown = "# Selected Goal\n\n- [ ] Next step\n";
    await writeFile(path.join(repositoryPath, "goal.md"), goalMarkdown);
    const firstRunProcess = createMockRunProcess(321);
    const secondRunProcess = createMockRunProcess(654);
    const spawnProcess = vi
      .fn()
      .mockReturnValueOnce(firstRunProcess)
      .mockReturnValueOnce(secondRunProcess);
    const app = await createTestServer({
      spawnProcess,
    });
    trackTestServer(app);
    const origin = await listenOnRandomPort(app);

    const response = await globalThis.fetch(`${origin}/api/events`);
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error("Missing SSE response body.");
    }

    await readSseChunk(reader);

    await browseRepository(app, repositoryPath);
    await readSseChunk(reader);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 2,
      },
    });
    await readUntilSsePayloads(reader, "summary");

    firstRunProcess.emit("close", 0, null);
    const nextRunSummaryPayloads = await readUntilSsePayloads(reader, "summary");
    const expectedCodexCommand = getCodexExecSpawnCommand(
      "Use goal.md as the source of truth.",
    );

    expect(spawnProcess).toHaveBeenCalledTimes(2);
    expect(spawnProcess).toHaveBeenNthCalledWith(
      2,
      expectedCodexCommand.command,
      expect.arrayContaining([
        "exec",
        "--json",
        "--output-last-message",
        "Use goal.md as the source of truth.",
      ]),
      {
        cwd: path.normalize(repositoryPath),
        windowsHide: true,
      },
    );
    expect(nextRunSummaryPayloads).toEqual([
      {
        status: "running",
        message: "Started Codex run 2 of 2.",
      },
    ]);

    const snapshotResponse = await globalThis.fetch(`${origin}/api/events`);
    const snapshotReader = snapshotResponse.body?.getReader();

    if (!snapshotReader) {
      throw new Error("Missing SSE response body.");
    }

    const snapshotChunk = await readSseChunk(snapshotReader);
    expect(parseSsePayloads(snapshotChunk, "progress")).toEqual([
      {
        currentRun: 2,
        totalRuns: 2,
      },
    ]);

    secondRunProcess.emit("close", 0, null);
    const completeSummaryPayloads = await readUntilSsePayloads(reader, "summary");
    await reader.cancel();
    await snapshotReader.cancel();

    expect(completeSummaryPayloads).toEqual([
      {
        status: "complete",
        message: `Completed Codex run 2 of 2 and refreshed goal.md (${goalMarkdown.length} characters).`,
      },
    ]);
  });

  it("stops with complete status when refreshed goal.md contains GOAL_COMPLETE", async () => {
    const repositoryPath = await createRepositoryPath();
    await writeFile(
      path.join(repositoryPath, "goal.md"),
      "# Selected Goal\n\nGOAL_COMPLETE\n",
    );
    const runProcess = createMockRunProcess();
    const spawnProcess = vi.fn(() => runProcess);
    const app = await createTestServer({
      spawnProcess,
    });
    trackTestServer(app);
    const origin = await listenOnRandomPort(app);

    const response = await globalThis.fetch(`${origin}/api/events`);
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error("Missing SSE response body.");
    }

    await readSseChunk(reader);

    await browseRepository(app, repositoryPath);
    await readSseChunk(reader);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 3,
      },
    });
    await readUntilSsePayloads(reader, "summary");

    runProcess.emit("close", 0, null);
    const summaryPayloads = await readUntilSsePayloads(reader, "summary");
    await reader.cancel();

    expect(summaryPayloads).toEqual([
      {
        status: "complete",
        message:
          "Stopped after Codex run 1 of 3 because refreshed goal.md contains GOAL_COMPLETE.",
      },
    ]);
    expect(spawnProcess).toHaveBeenCalledTimes(1);
  });

  it("stops with blocked status when refreshed goal.md contains GOAL_BLOCKED", async () => {
    const repositoryPath = await createRepositoryPath();
    await writeFile(
      path.join(repositoryPath, "goal.md"),
      "# Selected Goal\n\nGOAL_BLOCKED: waiting for user input\n",
    );
    const runProcess = createMockRunProcess();
    const spawnProcess = vi.fn(() => runProcess);
    const app = await createTestServer({
      spawnProcess,
    });
    trackTestServer(app);
    const origin = await listenOnRandomPort(app);

    const response = await globalThis.fetch(`${origin}/api/events`);
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error("Missing SSE response body.");
    }

    await readSseChunk(reader);

    await browseRepository(app, repositoryPath);
    await readSseChunk(reader);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 3,
      },
    });
    await readUntilSsePayloads(reader, "summary");

    runProcess.emit("close", 0, null);
    const summaryPayloads = await readUntilSsePayloads(reader, "summary");
    await reader.cancel();

    expect(summaryPayloads).toEqual([
      {
        status: "blocked",
        message:
          "Stopped after Codex run 1 of 3 because refreshed goal.md contains GOAL_BLOCKED.",
      },
    ]);
    expect(spawnProcess).toHaveBeenCalledTimes(1);
  });

  it("fails the run when goal.md cannot be re-read after a successful Codex run", async () => {
    const repositoryPath = await createRepositoryPath();
    const runProcess = createMockRunProcess();
    const app = await createTestServer({
      spawnProcess: vi.fn(() => runProcess),
    });
    trackTestServer(app);
    const origin = await listenOnRandomPort(app);

    const response = await globalThis.fetch(`${origin}/api/events`);
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error("Missing SSE response body.");
    }

    await readSseChunk(reader);

    await browseRepository(app, repositoryPath);
    await readSseChunk(reader);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
      },
    });

    runProcess.emit("close", 0, null);
    await reader.cancel();
    await vi.waitFor(async () => {
      expect(parseSsePayloads(await readSseSnapshot(origin), "summary")).toEqual([
        {
          status: "failed",
          message: "goal.md became unavailable after Codex run 1.",
        },
      ]);
    });
  });

  it("rejects a second run start request while a run is active", async () => {
    const repositoryPath = await createRepositoryPath();
    const app = await createTestServer();

    await browseRepository(app, repositoryPath);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "A run is already active.",
    });
  });

  it("does not start another Codex run while stop is requested and reports stopped after close", async () => {
    const repositoryPath = await createRepositoryPath();
    const goalMarkdown = "# Selected Goal\n\n- [ ] Next step\n";
    await writeFile(path.join(repositoryPath, "goal.md"), goalMarkdown);
    const firstRunProcess = createMockRunProcess(321);
    const secondRunProcess = createMockRunProcess(654);
    const spawnProcess = vi
      .fn()
      .mockReturnValueOnce(firstRunProcess)
      .mockReturnValueOnce(secondRunProcess);
    const app = await createTestServer({
      spawnProcess,
    });
    trackTestServer(app);
    const origin = await listenOnRandomPort(app);

    const sseResponse = await globalThis.fetch(`${origin}/api/events`);
    const reader = sseResponse.body?.getReader();

    if (!reader) {
      throw new Error("Missing SSE response body.");
    }

    await readSseChunk(reader);

    await browseRepository(app, repositoryPath);
    await readSseChunk(reader);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 2,
      },
    });
    await readUntilSsePayloads(reader, "summary");

    await app.inject({
      method: "POST",
      url: "/api/run/stop",
    });
    await readUntilSsePayloads(reader, "summary");

    const activeRestartResponse = await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
      },
    });

    firstRunProcess.emit("close", 0, null);
    const summaryPayloads = await readUntilSsePayloads(reader, "summary");

    const restartResponse = await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
      },
    });
    await reader.cancel();

    expect(activeRestartResponse.statusCode).toBe(409);
    expect(activeRestartResponse.json()).toEqual({
      error: "A run is already active.",
    });
    expect(restartResponse.statusCode).toBe(202);
    expect(spawnProcess).toHaveBeenCalledTimes(2);
    expect(summaryPayloads).toEqual([
      {
        status: "stopped",
        message:
          "Stopped after Codex run 1 of 2 because stop was requested; no additional Codex runs will start.",
      },
    ]);
  });

  it("rejects a stop request when no run is active", async () => {
    const app = await createTestServer();

    const response = await app.inject({
      method: "POST",
      url: "/api/run/stop",
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "No active run to stop.",
    });
  });

  it("rejects caller-provided stop options", async () => {
    const repositoryPath = await createRepositoryPath();
    const runProcess = createMockRunProcess();
    const app = await createTestServer({
      spawnProcess: vi.fn(() => runProcess),
    });
    trackTestServer(app);

    await browseRepository(app, repositoryPath);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
      },
    });

    const bodyResponse = await app.inject({
      method: "POST",
      url: "/api/run/stop",
      payload: {
        signal: "SIGKILL",
      },
    });
    const queryResponse = await app.inject({
      method: "POST",
      url: "/api/run/stop?signal=SIGKILL",
    });

    expect(bodyResponse.statusCode).toBe(400);
    expect(bodyResponse.json()).toEqual({
      error: "Invalid run stop request.",
      code: "VALIDATION_ERROR",
      issues: [
        {
          path: "request",
          message: "Unrecognized key(s) in object: 'signal'",
        },
      ],
    });
    expect(queryResponse.statusCode).toBe(400);
    expect(queryResponse.json()).toEqual({
      error: "Invalid run stop request.",
      code: "VALIDATION_ERROR",
      issues: [
        {
          path: "request",
          message: "Unrecognized key(s) in object: 'signal'",
        },
      ],
    });
    expect(runProcess.kill).not.toHaveBeenCalled();
  });

  it("marks the run as stopping and terminates the active Codex process", async () => {
    const repositoryPath = await createRepositoryPath();
    const runProcess = createMockRunProcess(987);
    const app = await createTestServer({
      spawnProcess: vi.fn(() => runProcess),
    });
    trackTestServer(app);
    const origin = await listenOnRandomPort(app);

    const response = await globalThis.fetch(`${origin}/api/events`);
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error("Missing SSE response body.");
    }

    await readSseChunk(reader);

    await browseRepository(app, repositoryPath);
    await readSseChunk(reader);

    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 2,
      },
    });
    await readUntilSsePayloads(reader, "summary");

    const stopResponse = await app.inject({
      method: "POST",
      url: "/api/run/stop",
    });
    const summaryPayloads = await readUntilSsePayloads(reader, "summary");

    runProcess.emit("close", null, "SIGTERM");
    const stoppedSummaryPayloads = await readUntilSsePayloads(reader, "summary");

    expect(stopResponse.statusCode).toBe(202);
    expect(stopResponse.json()).toEqual({
      status: "stopping",
      activeProcessId: 987,
      killSignalSent: true,
    });
    expect(runProcess.kill).toHaveBeenCalledTimes(1);
    expect(summaryPayloads).toEqual([
      {
        status: "stopping",
        message: "Stop requested; terminating the active Codex process.",
      },
    ]);
    expect(stoppedSummaryPayloads).toEqual([
      {
        status: "stopped",
        message:
          "Stopped after Codex run 1 of 2 because stop was requested; no additional Codex runs will start.",
      },
    ]);

    const snapshotResponse = await globalThis.fetch(`${origin}/api/events`);
    const snapshotReader = snapshotResponse.body?.getReader();

    if (!snapshotReader) {
      throw new Error("Missing SSE response body.");
    }

    const snapshotChunk = await readSseChunk(snapshotReader);
    await snapshotReader.cancel();

    expect(parseSsePayloads(snapshotChunk, "status")).toEqual([
      {
        status: "stopped",
        selectedRepositoryPath: path.normalize(repositoryPath),
      },
    ]);
    expect(parseSsePayloads(snapshotChunk, "summary")).toEqual([
      {
        status: "stopped",
        message:
          "Stopped after Codex run 1 of 2 because stop was requested; no additional Codex runs will start.",
      },
    ]);
    await reader.cancel();
  });
});
