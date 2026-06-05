import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tempPaths: string[] = [];

export async function createTempPath(): Promise<string> {
  const tempPath = await mkdtemp(path.join(os.tmpdir(), "codex-goal-runner-"));
  tempPaths.push(tempPath);
  return tempPath;
}

export async function createRepositoryPath(): Promise<string> {
  const repositoryPath = await createTempPath();
  await mkdir(path.join(repositoryPath, ".git"));
  return repositoryPath;
}

export async function createEscapingGoalPath(
  repositoryPath: string,
): Promise<string> {
  const outsidePath = await createTempPath();
  const goalPath = path.join(repositoryPath, "goal.md");

  await symlink(
    outsidePath,
    goalPath,
    process.platform === "win32" ? "junction" : "dir",
  );

  return goalPath;
}

export async function cleanupTempPaths(): Promise<void> {
  await Promise.all(
    tempPaths.splice(0).map((tempPath) =>
      rm(tempPath, {
        force: true,
        recursive: true,
      }),
    ),
  );
}
