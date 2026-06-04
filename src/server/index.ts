import cors from "@fastify/cors";
import { watch, type FSWatcher } from "chokidar";
import Fastify, { type FastifyInstance } from "fastify";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
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
type RunnerStatus = "idle";
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
type RuntimeStreamState = {
  status: RunnerStatus;
  logs: LogEntry[];
  progress: RunProgress;
  latestSummary: LatestSummary;
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
const emptyGoalRequestSchema = z.object({}).strict();

function createInitialStreamState(): RuntimeStreamState {
  return {
    status: "idle",
    logs: [],
    progress: {
      currentRun: 0,
      totalRuns: null,
    },
    latestSummary: null,
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
      status: streamState.status,
      selectedRepositoryPath,
    }),
    formatSseEvent("logs", {
      entries: streamState.logs,
    }),
    formatSseEvent("progress", streamState.progress),
    formatSseEvent("summary", streamState.latestSummary),
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

function getGoalFilePath(repositoryPath: string): string {
  const normalizedRepositoryPath = path.resolve(repositoryPath);
  const goalFilePath = path.resolve(normalizedRepositoryPath, "goal.md");
  const relativeGoalPath = path.relative(normalizedRepositoryPath, goalFilePath);

  if (
    relativeGoalPath === "" ||
    relativeGoalPath.startsWith("..") ||
    path.isAbsolute(relativeGoalPath)
  ) {
    throw new Error("Resolved goal path escaped the selected repository.");
  }

  return goalFilePath;
}

export async function buildServer(): Promise<FastifyInstance> {
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
  let goalWatcher: FSWatcher | null = null;
  let watchedGoalPath: string | null = null;

  function broadcastSseEvent<EventName extends keyof SseEventMap>(
    event: EventName,
    data: SseEventMap[EventName],
  ): void {
    const chunk = formatSseEvent(event, data);

    for (const client of sseClients.values()) {
      client.write(chunk);
    }
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
    });
    goalWatcher.on("add", () => {
      broadcastSseEvent("goalChanged", {
        repositoryPath,
        goalPath: goalFilePath,
        exists: true,
      });
    });
    goalWatcher.on("change", () => {
      broadcastSseEvent("goalChanged", {
        repositoryPath,
        goalPath: goalFilePath,
        exists: true,
      });
    });
    goalWatcher.on("unlink", () => {
      broadcastSseEvent("goalChanged", {
        repositoryPath,
        goalPath: goalFilePath,
        exists: false,
      });
    });
    watchedGoalPath = goalFilePath;
  }

  await server.register(cors, {
    origin: true,
  });

  server.addHook("onClose", async () => {
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
      markdown = await readFile(goalFilePath, "utf8");
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
      status: runtimeState.stream.status,
      selectedRepositoryPath: runtimeState.selectedRepositoryPath,
    });

    return {
      repositoryPath: runtimeState.selectedRepositoryPath,
    };
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

if (import.meta.url === `file://${process.argv[1]}`) {
  void startServer();
}
