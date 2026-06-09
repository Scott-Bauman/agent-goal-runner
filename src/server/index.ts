import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildServer } from "./server.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4317;

export { buildServer } from "./server.js";
export type { BuildServerOptions } from "./server.js";
export { detectGoalStopMarker } from "./goal/goalFile.js";
export { AGENT_PROVIDERS } from "./runner/agentProviders.js";
export type { AgentProvider } from "./runner/agentProviders.js";
export { getClaudePrintSpawnCommand } from "./runner/claudeCommand.js";
export { getCodexExecSpawnCommand } from "./runner/codexCommand.js";
export { RUNNER_STATUSES } from "./runner/statuses.js";
export type { RunnerStatus } from "./runner/statuses.js";

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
