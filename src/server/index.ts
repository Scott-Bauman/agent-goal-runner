import cors from "@fastify/cors";
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

function formatZodIssues(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join(".") || "request",
    message: issue.message,
  }));
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
  } = {
    selectedRepositoryPath: null,
  };

  await server.register(cors, {
    origin: true,
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

  server.get("/api/goal", async (request, reply) => {
    const parsedQuery = emptyGoalRequestSchema.safeParse(request.query);

    if (!parsedQuery.success) {
      return reply.code(400).send({
        error: "Invalid goal request.",
        issues: formatZodIssues(parsedQuery.error),
      });
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
      return reply.code(400).send({
        error: "Invalid goal creation request.",
        issues: [
          ...(!parsedQuery.success ? formatZodIssues(parsedQuery.error) : []),
          ...(!parsedBody.success ? formatZodIssues(parsedBody.error) : []),
        ],
      });
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
      return reply.code(400).send({
        error: "Invalid repository selection request.",
        issues: formatZodIssues(parsedBody.error),
      });
    }

    const repositoryPathIssue = await validateRepositoryPath(parsedBody.data.path);

    if (repositoryPathIssue) {
      return reply.code(400).send({
        error: "Invalid repository selection request.",
        issues: [
          {
            path: "path",
            message: repositoryPathIssue,
          },
        ],
      });
    }

    runtimeState.selectedRepositoryPath = parsedBody.data.path;

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
