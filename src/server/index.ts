import cors from "@fastify/cors";
import { watch, type FSWatcher } from "chokidar";
import Fastify, { type FastifyInstance } from "fastify";
import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4317;
const DEFAULT_GOAL_MARKDOWN = `# Project Goal

## Product Goal

Describe the desired end state for this repository.

## Future Codex Run Discipline

- Use this \`goal.md\` as the source of truth.
- Complete one unchecked checkbox or sub-checkbox at a time.
- Verify the change before marking a checkbox complete.
- Report what changed and what verification ran.

## Implementation Checklist

- [ ] Replace this default goal with project-specific implementation steps.
`;
export const RUNNER_STATUSES = [
  "idle",
  "running",
  "stopping",
  "complete",
  "blocked",
  "failed",
  "stopped",
] as const;
type RunnerStatus = (typeof RUNNER_STATUSES)[number];
const ACTIVE_RUN_STATUSES = new Set<RunnerStatus>(["running", "stopping"]);
type LogEntry = {
  id: number;
  stream: "system" | "stdout" | "stderr";
  message: string;
};
type RunProgress = {
  currentRun: number;
  totalRuns: number | null;
};
type LatestSummary = {
  status: RunnerStatus;
  message: string;
} | null;
type RunLoopState = {
  status: RunnerStatus;
  stopRequested: boolean;
  activeProcessId: number | null;
  progress: RunProgress;
  latestSummary: LatestSummary;
};
type RuntimeStreamState = {
  runLoop: RunLoopState;
  logs: LogEntry[];
};
type SseEventMap = {
  status: {
    status: RunnerStatus;
    selectedRepositoryPath: string | null;
  };
  goalChanged: {
    repositoryPath: string;
    goalPath: string;
    exists: boolean;
  };
  logs: {
    entries: LogEntry[];
  };
  progress: RunProgress;
  summary: LatestSummary;
};
type SseClient = {
  id: number;
  write: (chunk: string) => boolean;
};
type ProcessSpawner = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams;
type SpawnCommand = {
  command: string;
  args: string[];
};
type ParsedVerificationCommand = {
  executable: string;
  args: string[];
};
type VerificationCommandParseResult =
  | {
      success: true;
      parsed: ParsedVerificationCommand | null;
    }
  | {
      success: false;
      error: string;
    };
type BuildServerOptions = {
  spawnProcess?: ProcessSpawner;
};

class GoalPathRestrictionError extends Error {
  constructor() {
    super("goal.md resolves outside the selected repository.");
    this.name = "GoalPathRestrictionError";
  }
}

export function getCodexExecSpawnCommand(prompt: string): SpawnCommand {
  if (process.platform !== "win32") {
    return {
      command: "codex",
      args: ["exec", prompt],
    };
  }

  for (const pathEntry of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!pathEntry) {
      continue;
    }

    const codexEntrypoint = path.join(
      pathEntry,
      "node_modules",
      "@openai",
      "codex",
      "bin",
      "codex.js",
    );

    if (existsSync(codexEntrypoint)) {
      return {
        command: process.execPath,
        args: [codexEntrypoint, "exec", prompt],
      };
    }
  }

  return {
    command: "codex",
    args: ["exec", prompt],
  };
}

const SHELL_OPERATOR_CHARACTERS = new Set(["|", "&", ";", "<", ">", "`"]);
const SHELL_EXECUTABLES = new Set([
  "bash",
  "bash.exe",
  "cmd",
  "cmd.exe",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
  "sh",
  "sh.exe",
]);

const repositorySelectionSchema = z
  .object({
    path: z
      .string()
      .trim()
      .min(1, "Path is required.")
      .refine((value) => path.isAbsolute(value), {
        message: "Path must be an absolute local filesystem path.",
      })
      .transform((value) => path.normalize(value)),
  })
  .strict();
const runStartSchema = z
  .object({
    prompt: z.string().trim().min(1, "Prompt is required."),
    autoCommit: z
      .boolean({
        invalid_type_error: "Auto-commit toggle must be a boolean.",
      })
      .default(false),
    verificationCommand: z
      .string({
        invalid_type_error: "Verification command must be a string.",
      })
      .trim()
      .default("")
      .superRefine((value, context) => {
        const parsedCommand = parseVerificationCommand(value);

        if (!parsedCommand.success) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: parsedCommand.error,
          });
        }
      }),
    runCount: z
      .number({
        invalid_type_error: "Run count must be a number.",
        required_error: "Run count is required.",
      })
      .int("Run count must be a whole number.")
      .min(1, "Run count must be at least 1.")
      .max(100, "Run count must be at most 100."),
  })
  .strict();
const emptyGoalRequestSchema = z.object({}).strict();

function createInitialStreamState(): RuntimeStreamState {
  return {
    runLoop: {
      status: "idle",
      stopRequested: false,
      activeProcessId: null,
      progress: {
        currentRun: 0,
        totalRuns: null,
      },
      latestSummary: null,
    },
    logs: [],
  };
}

function formatSseEvent<EventName extends keyof SseEventMap>(
  event: EventName,
  data: SseEventMap[EventName],
): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function createSseSnapshot(
  streamState: RuntimeStreamState,
  selectedRepositoryPath: string | null,
): string {
  return [
    formatSseEvent("status", {
      status: streamState.runLoop.status,
      selectedRepositoryPath,
    }),
    formatSseEvent("logs", {
      entries: streamState.logs,
    }),
    formatSseEvent("progress", streamState.runLoop.progress),
    formatSseEvent("summary", streamState.runLoop.latestSummary),
  ].join("");
}

function formatZodIssues(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join(".") || "request",
    message: issue.message,
  }));
}

function validationError(
  error: string,
  issues: Array<{ path: string; message: string }>,
): {
  error: string;
  code: "VALIDATION_ERROR";
  issues: Array<{ path: string; message: string }>;
} {
  return {
    error,
    code: "VALIDATION_ERROR",
    issues,
  };
}

function parseVerificationCommand(command: string): VerificationCommandParseResult {
  const trimmedCommand = command.trim();

  if (!trimmedCommand) {
    return {
      success: true,
      parsed: null,
    };
  }

  const tokens: string[] = [];
  let currentToken = "";
  let tokenStarted = false;
  let quote: "\"" | "'" | null = null;
  let escaped = false;

  function appendCurrentToken(): void {
    if (tokenStarted) {
      tokens.push(currentToken);
      currentToken = "";
      tokenStarted = false;
    }
  }

  for (const character of trimmedCommand) {
    if (escaped) {
      tokenStarted = true;
      currentToken += character;
      escaped = false;
      continue;
    }

    if (quote) {
      if (character === "\\") {
        escaped = true;
        continue;
      }

      if (character === quote) {
        quote = null;
        continue;
      }

      currentToken += character;
      continue;
    }

    if (character === "\"" || character === "'") {
      tokenStarted = true;
      quote = character;
      continue;
    }

    if (/\s/u.test(character)) {
      appendCurrentToken();
      continue;
    }

    if (SHELL_OPERATOR_CHARACTERS.has(character)) {
      return {
        success: false,
        error:
          "Verification command must use a single executable plus arguments; shell operators are not supported.",
      };
    }

    tokenStarted = true;
    currentToken += character;
  }

  if (escaped) {
    tokenStarted = true;
    currentToken += "\\";
  }

  if (quote) {
    return {
      success: false,
      error: "Verification command contains an unterminated quoted argument.",
    };
  }

  appendCurrentToken();

  if (tokens.length === 0) {
    return {
      success: false,
      error: "Verification command must include an executable.",
    };
  }

  const [executable, ...args] = tokens;
  const executableName = path.basename(executable).toLowerCase();

  if (SHELL_EXECUTABLES.has(executableName)) {
    return {
      success: false,
      error: "Verification command must be a direct executable, not a shell.",
    };
  }

  return {
    success: true,
    parsed: {
      executable,
      args,
    },
  };
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }

    throw error;
  }
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === code
  );
}

function isGoalPathRestrictionError(error: unknown): error is GoalPathRestrictionError {
  return error instanceof GoalPathRestrictionError;
}

export function detectGoalStopMarker(
  markdown: string,
): "GOAL_COMPLETE" | "GOAL_BLOCKED" | null {
  if (markdown.includes("GOAL_BLOCKED")) {
    return "GOAL_BLOCKED";
  }

  if (markdown.includes("GOAL_COMPLETE")) {
    return "GOAL_COMPLETE";
  }

  return null;
}

async function validateRepositoryPath(repositoryPath: string): Promise<string | undefined> {
  let pathStats;

  try {
    pathStats = await stat(repositoryPath);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return "Path must exist.";
    }

    throw error;
  }

  if (!pathStats.isDirectory()) {
    return "Path must be an existing directory.";
  }

  const gitMarkerPath = path.join(repositoryPath, ".git");

  if (!(await pathExists(gitMarkerPath))) {
    return "Path must be a git repository.";
  }

  return undefined;
}

function isPathInsideDirectory(directoryPath: string, targetPath: string): boolean {
  const relativePath = path.relative(directoryPath, targetPath);

  return (
    relativePath !== "" &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath)
  );
}

function getGoalFilePath(repositoryPath: string): string {
  const normalizedRepositoryPath = path.resolve(repositoryPath);
  const goalFilePath = path.resolve(normalizedRepositoryPath, "goal.md");

  if (!isPathInsideDirectory(normalizedRepositoryPath, goalFilePath)) {
    throw new Error("Resolved goal path escaped the selected repository.");
  }

  return goalFilePath;
}

async function assertResolvedGoalPathInsideRepository(
  repositoryPath: string,
  goalFilePath: string,
): Promise<void> {
  const [resolvedRepositoryPath, resolvedGoalFilePath] = await Promise.all([
    realpath(repositoryPath),
    realpath(goalFilePath),
  ]);

  if (!isPathInsideDirectory(resolvedRepositoryPath, resolvedGoalFilePath)) {
    throw new GoalPathRestrictionError();
  }
}

async function readGoalMarkdown(repositoryPath: string): Promise<string> {
  const goalFilePath = getGoalFilePath(repositoryPath);

  await assertResolvedGoalPathInsideRepository(repositoryPath, goalFilePath);

  return readFile(goalFilePath, "utf8");
}

async function assertExistingGoalPathDoesNotEscape(
  repositoryPath: string,
  goalFilePath: string,
): Promise<void> {
  try {
    await assertResolvedGoalPathInsideRepository(repositoryPath, goalFilePath);
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return;
    }

    throw error;
  }
}

export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const spawnProcess = options.spawnProcess ?? spawn;
  const server = Fastify({
    logger: true,
  });
  const runtimeState: {
    selectedRepositoryPath: string | null;
    stream: RuntimeStreamState;
  } = {
    selectedRepositoryPath: null,
    stream: createInitialStreamState(),
  };
  const sseClients = new Map<number, SseClient>();
  let nextSseClientId = 1;
  let nextLogId = 1;
  let goalWatcher: FSWatcher | null = null;
  let watchedGoalPath: string | null = null;
  let activeRunProcess: ChildProcessWithoutNullStreams | null = null;
  let activeRunProcessKind: "codex" | "verification" | "git" | null = null;

  function broadcastSseEvent<EventName extends keyof SseEventMap>(
    event: EventName,
    data: SseEventMap[EventName],
  ): void {
    const chunk = formatSseEvent(event, data);

    for (const client of sseClients.values()) {
      client.write(chunk);
    }
  }

  function appendProcessLog(
    stream: Extract<LogEntry["stream"], "stdout" | "stderr">,
    chunk: Buffer | string,
  ): void {
    const message = typeof chunk === "string" ? chunk : chunk.toString("utf8");

    if (message.length === 0) {
      return;
    }

    const entry: LogEntry = {
      id: nextLogId,
      stream,
      message,
    };
    nextLogId += 1;
    runtimeState.stream.logs.push(entry);
    broadcastSseEvent("logs", {
      entries: [entry],
    });
  }

  async function readGoalMarkdownForRun(repositoryPath: string): Promise<string> {
    return readGoalMarkdown(repositoryPath);
  }

  function publishRunStatus(): void {
    broadcastSseEvent("status", {
      status: runtimeState.stream.runLoop.status,
      selectedRepositoryPath: runtimeState.selectedRepositoryPath,
    });
    broadcastSseEvent("summary", runtimeState.stream.runLoop.latestSummary);
  }

  function failRun(message: string): void {
    runtimeState.stream.runLoop = {
      ...runtimeState.stream.runLoop,
      status: "failed",
      stopRequested: false,
      activeProcessId: null,
      latestSummary: {
        status: "failed",
        message,
      },
    };
    publishRunStatus();
  }

  function handleProcessSpawnError(
    childProcess: ChildProcessWithoutNullStreams,
    message: string,
  ): void {
    if (activeRunProcess !== childProcess) {
      return;
    }

    activeRunProcess = null;
    activeRunProcessKind = null;
    failRun(message);
  }

  function requestRunStop(): boolean {
    if (!activeRunProcess) {
      return false;
    }

    const activeProcessId = activeRunProcess.pid ?? null;
    const activeProcessLabel =
      activeRunProcessKind === "verification"
        ? "verification process"
        : activeRunProcessKind === "git"
          ? "git process"
          : "Codex process";
    runtimeState.stream.runLoop = {
      ...runtimeState.stream.runLoop,
      status: "stopping",
      stopRequested: true,
      activeProcessId,
      latestSummary: {
        status: "stopping",
        message: `Stop requested; terminating the active ${activeProcessLabel}.`,
      },
    };
    publishRunStatus();

    return activeRunProcess.kill();
  }

  async function stopGoalWatcher(): Promise<void> {
    await goalWatcher?.close();
    goalWatcher = null;
    watchedGoalPath = null;
  }

  async function replaceGoalWatcher(repositoryPath: string): Promise<void> {
    const goalFilePath = getGoalFilePath(repositoryPath);

    if (goalWatcher && watchedGoalPath === goalFilePath) {
      return;
    }

    await stopGoalWatcher();

    goalWatcher = watch(goalFilePath, {
      ignoreInitial: true,
      ignored: (watchedPath, stats) =>
        Boolean(stats?.isFile() && path.resolve(watchedPath) !== goalFilePath),
    });

    const broadcastGoalChanged = (exists: boolean): void => {
      broadcastSseEvent("goalChanged", {
        repositoryPath,
        goalPath: goalFilePath,
        exists,
      });
    };

    const handleGoalWatcherEvent = (changedPath: string, exists: boolean): void => {
      if (path.resolve(changedPath) !== goalFilePath) {
        return;
      }

      broadcastGoalChanged(exists);
    };

    goalWatcher.on("add", (changedPath) => {
      handleGoalWatcherEvent(changedPath, true);
    });
    goalWatcher.on("change", (changedPath) => {
      handleGoalWatcherEvent(changedPath, true);
    });
    goalWatcher.on("unlink", (changedPath) => {
      handleGoalWatcherEvent(changedPath, false);
    });
    watchedGoalPath = goalFilePath;
  }

  await server.register(cors, {
    origin: true,
  });

  server.addHook("onClose", async () => {
    activeRunProcess?.kill();
    activeRunProcess = null;
    activeRunProcessKind = null;
    await stopGoalWatcher();
  });

  server.get("/", async () => ({
    name: "codex-goal-runner",
    status: "ok",
  }));

  server.get("/health", async () => ({
    status: "ok",
  }));

  server.get("/api/repository/selection", async () => ({
    repositoryPath: runtimeState.selectedRepositoryPath,
  }));

  server.get("/api/events", async (request, reply) => {
    const parsedQuery = emptyGoalRequestSchema.safeParse(request.query);

    if (!parsedQuery.success) {
      return reply
        .code(400)
        .send(
          validationError("Invalid events request.", formatZodIssues(parsedQuery.error)),
        );
    }

    reply.hijack();
    request.raw.socket.setTimeout(0);
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const client: SseClient = {
      id: nextSseClientId,
      write: (chunk) => reply.raw.write(chunk),
    };
    nextSseClientId += 1;
    sseClients.set(client.id, client);
    client.write(createSseSnapshot(runtimeState.stream, runtimeState.selectedRepositoryPath));

    request.raw.on("close", () => {
      sseClients.delete(client.id);
    });

    return undefined;
  });

  server.get("/api/goal", async (request, reply) => {
    const parsedQuery = emptyGoalRequestSchema.safeParse(request.query);

    if (!parsedQuery.success) {
      return reply
        .code(400)
        .send(
          validationError("Invalid goal request.", formatZodIssues(parsedQuery.error)),
        );
    }

    if (!runtimeState.selectedRepositoryPath) {
      return reply.code(409).send({
        error: "No repository selected.",
      });
    }

    const goalFilePath = getGoalFilePath(runtimeState.selectedRepositoryPath);
    let markdown: string;

    try {
      markdown = await readGoalMarkdown(runtimeState.selectedRepositoryPath);
    } catch (error) {
      if (isNodeErrorCode(error, "ENOENT")) {
        return reply.code(404).send({
          error: "goal.md does not exist in the selected repository.",
          code: "GOAL_MISSING",
          repositoryPath: runtimeState.selectedRepositoryPath,
          goalPath: goalFilePath,
          exists: false,
        });
      }

      if (isGoalPathRestrictionError(error)) {
        return reply.code(400).send({
          error: error.message,
          code: "GOAL_PATH_RESTRICTED",
          repositoryPath: runtimeState.selectedRepositoryPath,
          goalPath: goalFilePath,
        });
      }

      throw error;
    }

    return {
      repositoryPath: runtimeState.selectedRepositoryPath,
      goalPath: goalFilePath,
      markdown,
    };
  });

  server.post("/api/goal", async (request, reply) => {
    const parsedQuery = emptyGoalRequestSchema.safeParse(request.query);
    const parsedBody = emptyGoalRequestSchema.safeParse(request.body ?? {});

    if (!parsedQuery.success || !parsedBody.success) {
      return reply.code(400).send(
        validationError("Invalid goal creation request.", [
          ...(!parsedQuery.success ? formatZodIssues(parsedQuery.error) : []),
          ...(!parsedBody.success ? formatZodIssues(parsedBody.error) : []),
        ]),
      );
    }

    if (!runtimeState.selectedRepositoryPath) {
      return reply.code(409).send({
        error: "No repository selected.",
      });
    }

    const goalFilePath = getGoalFilePath(runtimeState.selectedRepositoryPath);

    try {
      await assertExistingGoalPathDoesNotEscape(
        runtimeState.selectedRepositoryPath,
        goalFilePath,
      );
      await writeFile(goalFilePath, DEFAULT_GOAL_MARKDOWN, {
        encoding: "utf8",
        flag: "wx",
      });
    } catch (error) {
      if (isNodeErrorCode(error, "EEXIST")) {
        return reply.code(409).send({
          error: "goal.md already exists in the selected repository.",
          code: "GOAL_EXISTS",
          repositoryPath: runtimeState.selectedRepositoryPath,
          goalPath: goalFilePath,
          exists: true,
        });
      }

      if (isGoalPathRestrictionError(error)) {
        return reply.code(400).send({
          error: error.message,
          code: "GOAL_PATH_RESTRICTED",
          repositoryPath: runtimeState.selectedRepositoryPath,
          goalPath: goalFilePath,
        });
      }

      throw error;
    }

    return reply.code(201).send({
      repositoryPath: runtimeState.selectedRepositoryPath,
      goalPath: goalFilePath,
      markdown: DEFAULT_GOAL_MARKDOWN,
      exists: true,
    });
  });

  server.post("/api/repository/select", async (request, reply) => {
    const parsedBody = repositorySelectionSchema.safeParse(request.body);

    if (!parsedBody.success) {
      return reply
        .code(400)
        .send(
          validationError(
            "Invalid repository selection request.",
            formatZodIssues(parsedBody.error),
          ),
        );
    }

    const repositoryPathIssue = await validateRepositoryPath(parsedBody.data.path);

    if (repositoryPathIssue) {
      return reply.code(400).send(
        validationError("Invalid repository selection request.", [
          {
            path: "path",
            message: repositoryPathIssue,
          },
        ]),
      );
    }

    runtimeState.selectedRepositoryPath = parsedBody.data.path;
    await replaceGoalWatcher(runtimeState.selectedRepositoryPath);
    broadcastSseEvent("status", {
      status: runtimeState.stream.runLoop.status,
      selectedRepositoryPath: runtimeState.selectedRepositoryPath,
    });

    return {
      repositoryPath: runtimeState.selectedRepositoryPath,
    };
  });

  server.post("/api/run/start", async (request, reply) => {
    const parsedBody = runStartSchema.safeParse(request.body);

    if (!parsedBody.success) {
      return reply
        .code(400)
        .send(
          validationError("Invalid run start request.", formatZodIssues(parsedBody.error)),
        );
    }

    if (!runtimeState.selectedRepositoryPath) {
      return reply.code(409).send({
        error: "No repository selected.",
      });
    }

    if (ACTIVE_RUN_STATUSES.has(runtimeState.stream.runLoop.status)) {
      return reply.code(409).send({
        error: "A run is already active.",
      });
    }

    const repositoryPath = runtimeState.selectedRepositoryPath;
    const { prompt, runCount, verificationCommand, autoCommit } = parsedBody.data;
    const verificationCommandParse = parseVerificationCommand(verificationCommand);

    if (!verificationCommandParse.success) {
      return reply.code(400).send(
        validationError("Invalid run start request.", [
          {
            path: "verificationCommand",
            message: verificationCommandParse.error,
          },
        ]),
      );
    }

    const verificationCommandToRun = verificationCommandParse.parsed;

    function startCodexRun(runNumber: number): void {
      const codexCommand = getCodexExecSpawnCommand(prompt);
      const childProcess = spawnProcess(codexCommand.command, codexCommand.args, {
        cwd: repositoryPath,
        windowsHide: true,
      });

      childProcess.stdout.on("data", (chunk: Buffer | string) => {
        appendProcessLog("stdout", chunk);
      });
      childProcess.stderr.on("data", (chunk: Buffer | string) => {
        appendProcessLog("stderr", chunk);
      });
      childProcess.stdin.end();
      childProcess.on("error", () => {
        handleProcessSpawnError(
          childProcess,
          `Failed to start Codex run ${runNumber}; ensure the Codex CLI is installed and available on PATH.`,
        );
      });
      childProcess.on("close", (code) => {
        void (async () => {
          if (activeRunProcess !== childProcess) {
            return;
          }

          activeRunProcess = null;
          activeRunProcessKind = null;

          if (runtimeState.stream.runLoop.stopRequested) {
            runtimeState.stream.runLoop = {
              ...runtimeState.stream.runLoop,
              status: "stopped",
              stopRequested: false,
              activeProcessId: null,
              latestSummary: {
                status: "stopped",
                message: `Stopped after Codex run ${runNumber} of ${runCount} because stop was requested; no additional Codex runs will start.`,
              },
            };
            publishRunStatus();
            return;
          }

          if (code === 0) {
            if (verificationCommandToRun) {
              const verificationSucceeded = await runVerificationCommand(runNumber);

              if (!verificationSucceeded) {
                return;
              }
            }

            if (autoCommit) {
              const commitSucceeded = await runAutoCommit(runNumber);

              if (!commitSucceeded) {
                return;
              }
            }

            let refreshedGoalMarkdown: string;

            try {
              refreshedGoalMarkdown = await readGoalMarkdownForRun(repositoryPath);
            } catch (error) {
              failRun(
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

              runtimeState.stream.runLoop = {
                ...runtimeState.stream.runLoop,
                status: markerStatus,
                stopRequested: false,
                activeProcessId: null,
                latestSummary: {
                  status: markerStatus,
                  message: `Stopped after Codex run ${runNumber} of ${runCount} because refreshed goal.md contains ${goalStopMarker}.`,
                },
              };
              publishRunStatus();
              return;
            }

            if (runNumber < runCount) {
              startCodexRun(runNumber + 1);
              return;
            }

            runtimeState.stream.runLoop = {
              ...runtimeState.stream.runLoop,
              status: "complete",
              stopRequested: false,
              activeProcessId: null,
              latestSummary: {
                status: "complete",
                message: `Completed Codex run ${runNumber} of ${runCount} and refreshed goal.md (${refreshedGoalMarkdown.length} characters).`,
              },
            };
            publishRunStatus();
            return;
          }

          failRun(
            code === null
              ? `Codex run ${runNumber} exited without an exit code.`
              : `Codex run ${runNumber} exited with code ${code}.`,
          );
        })();
      });
      activeRunProcess = childProcess;
      activeRunProcessKind = "codex";

      runtimeState.stream.runLoop = {
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
      broadcastSseEvent("status", {
        status: runtimeState.stream.runLoop.status,
        selectedRepositoryPath: runtimeState.selectedRepositoryPath,
      });
      broadcastSseEvent("progress", runtimeState.stream.runLoop.progress);
      broadcastSseEvent("summary", runtimeState.stream.runLoop.latestSummary);
    }

    async function runAutoCommit(runNumber: number): Promise<boolean> {
      const addSucceeded = await runGitCommand(
        ["add", "-A"],
        `Started auto-commit staging after Codex run ${runNumber} of ${runCount}.`,
        (code) =>
          code === null
            ? `Auto-commit staging after Codex run ${runNumber} exited without an exit code.`
            : `Auto-commit staging after Codex run ${runNumber} exited with code ${code}.`,
        runNumber,
      );

      if (!addSucceeded) {
        return false;
      }

      const statusOutput = await runGitStatusBeforeCommit(runNumber);

      if (statusOutput === null) {
        return false;
      }

      if (statusOutput.trim().length === 0) {
        runtimeState.stream.runLoop = {
          ...runtimeState.stream.runLoop,
          activeProcessId: null,
          latestSummary: {
            status: "running",
            message: `Skipped auto-commit after Codex run ${runNumber} of ${runCount} because git status reported no changes.`,
          },
        };
        publishRunStatus();
        return true;
      }

      return runGitCommand(
        ["commit", ...createAutoCommitMessageArgs(runNumber, runCount)],
        `Started auto-commit after Codex run ${runNumber} of ${runCount}.`,
        (code) =>
          code === null
            ? `Auto-commit after Codex run ${runNumber} exited without an exit code.`
            : `Auto-commit after Codex run ${runNumber} exited with code ${code}.`,
        runNumber,
      );
    }

    function createAutoCommitMessageArgs(runNumber: number, totalRuns: number): string[] {
      return [
        "-m",
        `codex-goal-runner: apply Codex run ${runNumber} of ${totalRuns}`,
        "-m",
        "Generated by codex-goal-runner after Codex and optional verification succeeded.",
      ];
    }

    function runGitStatusBeforeCommit(runNumber: number): Promise<string | null> {
      return new Promise((resolve) => {
        let stdout = "";
        const gitProcess = spawnProcess("git", ["status", "--porcelain"], {
          cwd: repositoryPath,
          windowsHide: true,
        });

        activeRunProcess = gitProcess;
        activeRunProcessKind = "git";
        runtimeState.stream.runLoop = {
          ...runtimeState.stream.runLoop,
          activeProcessId: gitProcess.pid ?? null,
          latestSummary: {
            status: "running",
            message: `Started auto-commit status check after Codex run ${runNumber} of ${runCount}.`,
          },
        };
        publishRunStatus();

        gitProcess.stdout.on("data", (chunk: Buffer | string) => {
          stdout += chunk.toString();
          appendProcessLog("stdout", chunk);
        });
        gitProcess.stderr.on("data", (chunk: Buffer | string) => {
          appendProcessLog("stderr", chunk);
        });
        gitProcess.on("error", () => {
          handleProcessSpawnError(
            gitProcess,
            `Failed to start auto-commit status check after Codex run ${runNumber}; ensure git is installed and available on PATH.`,
          );
          resolve(null);
        });
        gitProcess.on("close", (code) => {
          if (activeRunProcess !== gitProcess) {
            resolve(null);
            return;
          }

          activeRunProcess = null;
          activeRunProcessKind = null;

          if (runtimeState.stream.runLoop.stopRequested) {
            runtimeState.stream.runLoop = {
              ...runtimeState.stream.runLoop,
              status: "stopped",
              stopRequested: false,
              activeProcessId: null,
              latestSummary: {
                status: "stopped",
                message: `Stopped during auto-commit status check after Codex run ${runNumber} of ${runCount} because stop was requested; no additional Codex runs will start.`,
              },
            };
            publishRunStatus();
            resolve(null);
            return;
          }

          if (code === 0) {
            resolve(stdout);
            return;
          }

          failRun(
            code === null
              ? `Auto-commit status check after Codex run ${runNumber} exited without an exit code.`
              : `Auto-commit status check after Codex run ${runNumber} exited with code ${code}.`,
          );
          resolve(null);
        });
      });
    }

    function runGitCommand(
      args: string[],
      startMessage: string,
      failureMessage: (code: number | null) => string,
      runNumber: number,
    ): Promise<boolean> {
      return new Promise((resolve) => {
        const gitProcess = spawnProcess("git", args, {
          cwd: repositoryPath,
          windowsHide: true,
        });

        activeRunProcess = gitProcess;
        activeRunProcessKind = "git";
        runtimeState.stream.runLoop = {
          ...runtimeState.stream.runLoop,
          activeProcessId: gitProcess.pid ?? null,
          latestSummary: {
            status: "running",
            message: startMessage,
          },
        };
        publishRunStatus();

        gitProcess.stdout.on("data", (chunk: Buffer | string) => {
          appendProcessLog("stdout", chunk);
        });
        gitProcess.stderr.on("data", (chunk: Buffer | string) => {
          appendProcessLog("stderr", chunk);
        });
        gitProcess.on("error", () => {
          handleProcessSpawnError(
            gitProcess,
            "Failed to start git for auto-commit; ensure git is installed and available on PATH.",
          );
          resolve(false);
        });
        gitProcess.on("close", (code) => {
          if (activeRunProcess !== gitProcess) {
            resolve(false);
            return;
          }

          activeRunProcess = null;
          activeRunProcessKind = null;

          if (runtimeState.stream.runLoop.stopRequested) {
            runtimeState.stream.runLoop = {
              ...runtimeState.stream.runLoop,
              status: "stopped",
              stopRequested: false,
              activeProcessId: null,
              latestSummary: {
                status: "stopped",
                message: `Stopped during auto-commit after Codex run ${runNumber} of ${runCount} because stop was requested; no additional Codex runs will start.`,
              },
            };
            publishRunStatus();
            resolve(false);
            return;
          }

          if (code === 0) {
            resolve(true);
            return;
          }

          failRun(failureMessage(code));
          resolve(false);
        });
      });
    }

    function runVerificationCommand(runNumber: number): Promise<boolean> {
      if (!verificationCommandToRun) {
        return Promise.resolve(true);
      }

      return new Promise((resolve) => {
        const verificationProcess = spawnProcess(
          verificationCommandToRun.executable,
          verificationCommandToRun.args,
          {
            cwd: repositoryPath,
            windowsHide: true,
          },
        );

        activeRunProcess = verificationProcess;
        activeRunProcessKind = "verification";
        runtimeState.stream.runLoop = {
          ...runtimeState.stream.runLoop,
          activeProcessId: verificationProcess.pid ?? null,
          latestSummary: {
            status: "running",
            message: `Started verification after Codex run ${runNumber} of ${runCount}.`,
          },
        };
        publishRunStatus();

        verificationProcess.stdout.on("data", (chunk: Buffer | string) => {
          appendProcessLog("stdout", chunk);
        });
        verificationProcess.stderr.on("data", (chunk: Buffer | string) => {
          appendProcessLog("stderr", chunk);
        });
        verificationProcess.on("error", () => {
          handleProcessSpawnError(
            verificationProcess,
            `Failed to start verification after Codex run ${runNumber}; ensure the verification executable is installed and available on PATH.`,
          );
          resolve(false);
        });
        verificationProcess.on("close", (code) => {
          if (activeRunProcess !== verificationProcess) {
            resolve(false);
            return;
          }

          activeRunProcess = null;
          activeRunProcessKind = null;

          if (runtimeState.stream.runLoop.stopRequested) {
            runtimeState.stream.runLoop = {
              ...runtimeState.stream.runLoop,
              status: "stopped",
              stopRequested: false,
              activeProcessId: null,
              latestSummary: {
                status: "stopped",
                message: `Stopped after verification for Codex run ${runNumber} of ${runCount} because stop was requested; no additional Codex runs will start.`,
              },
            };
            publishRunStatus();
            resolve(false);
            return;
          }

          if (code === 0) {
            resolve(true);
            return;
          }

          failRun(
            code === null
              ? `Verification after Codex run ${runNumber} exited without an exit code.`
              : `Verification after Codex run ${runNumber} exited with code ${code}.`,
          );
          resolve(false);
        });
      });
    }

    startCodexRun(1);

    return reply.code(202).send({
      status: runtimeState.stream.runLoop.status,
      repositoryPath,
      prompt,
      runCount,
      verificationCommand,
      autoCommit,
    });
  });

  server.post("/api/run/stop", async (request, reply) => {
    const parsedQuery = emptyGoalRequestSchema.safeParse(request.query);
    const parsedBody = emptyGoalRequestSchema.safeParse(request.body ?? {});

    if (!parsedQuery.success || !parsedBody.success) {
      return reply.code(400).send(
        validationError("Invalid run stop request.", [
          ...(!parsedQuery.success ? formatZodIssues(parsedQuery.error) : []),
          ...(!parsedBody.success ? formatZodIssues(parsedBody.error) : []),
        ]),
      );
    }

    if (!activeRunProcess) {
      return reply.code(409).send({
        error: "No active run to stop.",
      });
    }

    const killSignalSent = requestRunStop();

    return reply.code(202).send({
      status: runtimeState.stream.runLoop.status,
      activeProcessId: runtimeState.stream.runLoop.activeProcessId,
      killSignalSent,
    });
  });

  return server;
}

async function startServer(): Promise<void> {
  const server = await buildServer();
  const host = process.env.HOST || DEFAULT_HOST;
  const port = Number.parseInt(process.env.PORT || "", 10) || DEFAULT_PORT;

  try {
    await server.listen({ host, port });
  } catch (error) {
    server.log.error(error);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])
) {
  void startServer();
}
