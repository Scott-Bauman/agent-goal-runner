import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GoalWatcherController } from "./goal/goalWatcher.js";
import { openFolderDialog } from "./repository/folderDialog.js";
import type { FolderDialogResult } from "./repository/folderDialog.js";
import { registerEventsRoutes } from "./routes/eventsRoutes.js";
import { registerGoalRoutes } from "./routes/goalRoutes.js";
import { registerHealthRoutes } from "./routes/healthRoutes.js";
import { registerRepositoryRoutes } from "./routes/repositoryRoutes.js";
import { registerRunRoutes } from "./routes/runRoutes.js";
import { registerSkillRoutes } from "./routes/skillRoutes.js";
import { RunController } from "./runner/runController.js";
import type { ProcessSpawner } from "./shared/process.js";
import type { RuntimeState, ServerRuntimeContext } from "./shared/runtime.js";
import { createInitialStreamState, SseHub } from "./sse/sseHub.js";

export type BuildServerOptions = {
  openRepositoryFolderDialog?: () => Promise<FolderDialogResult>;
  skillAppRootPath?: string;
  skillUserHomePath?: string;
  spawnProcess?: ProcessSpawner;
  webStaticRootPath?: string | false;
};

const DEFAULT_WEB_STATIC_ROOT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "web",
);
const DEFAULT_WEB_STATIC_ROOT_IS_REQUIRED =
  path.basename(path.dirname(DEFAULT_WEB_STATIC_ROOT_PATH)) === "dist";
const ALLOWED_DEV_ORIGINS = new Set([
  "http://127.0.0.1:5173",
  "http://localhost:5173",
]);

function resolveWebStaticRootPath(
  configuredPath: BuildServerOptions["webStaticRootPath"],
): string | null {
  if (configuredPath === false) {
    return null;
  }

  const staticRootPath = configuredPath ?? DEFAULT_WEB_STATIC_ROOT_PATH;

  if (existsSync(path.join(staticRootPath, "index.html"))) {
    return staticRootPath;
  }

  if (configuredPath || DEFAULT_WEB_STATIC_ROOT_IS_REQUIRED) {
    throw new Error(
      `Built frontend index.html was not found in ${staticRootPath}. Run npm run build:web first.`,
    );
  }

  return null;
}

async function registerWebStaticRoutes(
  server: FastifyInstance,
  webStaticRootPath: string,
): Promise<void> {
  await server.register(fastifyStatic, {
    root: webStaticRootPath,
    maxAge: "30d",
    immutable: true,
  });

  const sendAppShell = (_request: FastifyRequest, reply: FastifyReply) =>
    reply.type("text/html").sendFile("index.html", { maxAge: 0 });

  server.get("/", sendAppShell);

  server.setNotFoundHandler((request, reply) => {
    const url = request.url;
    const acceptsHtml = request.headers.accept?.includes("text/html") ?? false;
    const isApiPath = url === "/api" || url.startsWith("/api/");

    if (
      (request.method === "GET" || request.method === "HEAD") &&
      !isApiPath &&
      acceptsHtml
    ) {
      return reply.type("text/html").sendFile("index.html", { maxAge: 0 });
    }

    return reply.code(404).send({
      error: "Not Found",
      message: `Route ${request.method}:${url} not found`,
      statusCode: 404,
    });
  });
}

function getHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);

    if (url.pathname !== "/" || url.search || url.hash) {
      return null;
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

function normalizeHost(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(`http://${value}`).host.toLowerCase();
  } catch {
    return null;
  }
}

function isApiRequestPath(url: string): boolean {
  return url === "/api" || url.startsWith("/api/") || url.startsWith("/api?");
}

function isAllowedRequestOrigin(
  originHeader: string | undefined,
  hostHeader: string | undefined,
): boolean {
  if (!originHeader) {
    return true;
  }

  const origin = normalizeOrigin(originHeader);

  if (!origin) {
    return false;
  }

  if (ALLOWED_DEV_ORIGINS.has(origin)) {
    return true;
  }

  const requestHost = normalizeHost(hostHeader);
  const originHost = new URL(origin).host.toLowerCase();

  return requestHost !== null && originHost === requestHost;
}

function isAllowedCorsOrigin(originHeader: string | undefined): boolean {
  if (!originHeader) {
    return true;
  }

  const origin = normalizeOrigin(originHeader);

  return origin !== null && ALLOWED_DEV_ORIGINS.has(origin);
}

export async function buildServer(
  options: BuildServerOptions = {},
): Promise<FastifyInstance> {
  const spawnProcess = options.spawnProcess ?? spawn;
  const server = Fastify({
    logger: true,
  });
  const webStaticRootPath = resolveWebStaticRootPath(options.webStaticRootPath);
  const runtimeState: RuntimeState = {
    selectedRepositoryPath: null,
    stream: createInitialStreamState(),
  };
  const sseHub = new SseHub();
  const goalWatcher = new GoalWatcherController(sseHub);
  const runController = new RunController(runtimeState, sseHub, spawnProcess, {
    appRootPath: options.skillAppRootPath,
    userHomePath: options.skillUserHomePath,
  });
  const context: ServerRuntimeContext = {
    runtimeState,
    sseHub,
    goalWatcher,
    runController,
    skillAppRootPath: options.skillAppRootPath,
    skillUserHomePath: options.skillUserHomePath,
    openRepositoryFolderDialog:
      options.openRepositoryFolderDialog ?? openFolderDialog,
    spawnProcess,
  };

  server.addHook("onRequest", async (request, reply) => {
    if (
      !isApiRequestPath(request.url) ||
      isAllowedRequestOrigin(
        getHeaderValue(request.headers.origin),
        getHeaderValue(request.headers.host),
      )
    ) {
      return;
    }

    await reply.code(403).send({
      error: "Forbidden origin.",
    });
  });

  await server.register(cors, {
    origin: (origin, callback) => {
      callback(null, isAllowedCorsOrigin(origin));
    },
  });

  server.addHook("onClose", async () => {
    runController.dispose();
    await goalWatcher.stop();
  });

  registerHealthRoutes(server, {
    includeRootStatus: webStaticRootPath === null,
  });
  registerRepositoryRoutes(server, context);
  registerEventsRoutes(server, context);
  registerGoalRoutes(server, context);
  registerSkillRoutes(server, context);
  registerRunRoutes(server, context);

  if (webStaticRootPath) {
    await registerWebStaticRoutes(server, webStaticRootPath);
  }

  return server;
}
