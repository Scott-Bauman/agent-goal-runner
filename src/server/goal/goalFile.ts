import { randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { isNodeErrorCode } from "../shared/nodeErrors.js";

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

class GoalPathRestrictionError extends Error {
  constructor() {
    super("goal.md resolves outside the selected repository.");
    this.name = "GoalPathRestrictionError";
  }
}

class GoalRevisionMismatchError extends Error {
  readonly actualRevision: string;
  readonly expectedRevision: string;

  constructor({
    actualRevision,
    expectedRevision,
  }: {
    actualRevision: string;
    expectedRevision: string;
  }) {
    super("goal.md changed before the update could be saved.");
    this.name = "GoalRevisionMismatchError";
    this.actualRevision = actualRevision;
    this.expectedRevision = expectedRevision;
  }
}

export function isGoalPathRestrictionError(
  error: unknown,
): error is GoalPathRestrictionError {
  return error instanceof GoalPathRestrictionError;
}

export function isGoalRevisionMismatchError(
  error: unknown,
): error is GoalRevisionMismatchError {
  return error instanceof GoalRevisionMismatchError;
}

export function detectGoalStopMarker(
  markdown: string,
): "GOAL_COMPLETE" | "GOAL_BLOCKED" | null {
  const lines = markdown.split(/\r?\n/).map((line) => line.trim());

  if (
    lines.some(
      (line) => line === "GOAL_BLOCKED" || line.startsWith("GOAL_BLOCKED:"),
    )
  ) {
    return "GOAL_BLOCKED";
  }

  if (lines.includes("GOAL_COMPLETE")) {
    return "GOAL_COMPLETE";
  }

  return null;
}

function isPathInsideDirectory(
  directoryPath: string,
  targetPath: string,
): boolean {
  const relativePath = path.relative(directoryPath, targetPath);

  return (
    relativePath !== "" &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath)
  );
}

export function getGoalFilePath(repositoryPath: string): string {
  const normalizedRepositoryPath = path.resolve(repositoryPath);
  const goalFilePath = path.resolve(normalizedRepositoryPath, "goal.md");

  if (!isPathInsideDirectory(normalizedRepositoryPath, goalFilePath)) {
    throw new Error("Resolved goal path escaped the selected repository.");
  }

  return goalFilePath;
}

export async function assertResolvedGoalPathInsideRepository(
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

async function assertGoalPathIsNotSymlink(goalFilePath: string): Promise<void> {
  const goalPathStats = await lstat(goalFilePath);

  if (goalPathStats.isSymbolicLink()) {
    throw new GoalPathRestrictionError();
  }
}

function getGoalRevision(goalFileStats: Stats): string {
  return [
    goalFileStats.mtimeMs.toString(36),
    goalFileStats.size.toString(36),
    goalFileStats.ino.toString(36),
  ].join("-");
}

function isSameFile(firstStats: Stats, secondStats: Stats): boolean {
  return (
    firstStats.dev === secondStats.dev &&
    firstStats.ino === secondStats.ino &&
    firstStats.size === secondStats.size &&
    firstStats.mtimeMs === secondStats.mtimeMs
  );
}

async function readGoalFileMetadata(
  repositoryPath: string,
  goalFilePath: string,
): Promise<Stats> {
  await assertResolvedGoalPathInsideRepository(repositoryPath, goalFilePath);
  await assertGoalPathIsNotSymlink(goalFilePath);

  return stat(goalFilePath);
}

async function readVerifiedGoalFile(
  repositoryPath: string,
  goalFilePath: string,
): Promise<{
  markdown: string;
  stats: Stats;
}> {
  const checkedStats = await readGoalFileMetadata(repositoryPath, goalFilePath);
  let goalFile;

  try {
    goalFile = await open(goalFilePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (isNodeErrorCode(error, "ELOOP")) {
      throw new GoalPathRestrictionError();
    }

    throw error;
  }

  try {
    const openedStats = await goalFile.stat();

    if (!isSameFile(checkedStats, openedStats)) {
      throw new GoalPathRestrictionError();
    }

    return {
      markdown: await goalFile.readFile("utf8"),
      stats: openedStats,
    };
  } finally {
    await goalFile.close();
  }
}

export async function readGoalMarkdown(repositoryPath: string): Promise<string> {
  const goalFilePath = getGoalFilePath(repositoryPath);
  const goalFile = await readVerifiedGoalFile(repositoryPath, goalFilePath);

  return goalFile.markdown;
}

export async function readGoalMarkdownWithRevision(
  repositoryPath: string,
): Promise<{
  goalPath: string;
  markdown: string;
  revision: string;
}> {
  const goalPath = getGoalFilePath(repositoryPath);
  const goalFile = await readVerifiedGoalFile(repositoryPath, goalPath);

  return {
    goalPath,
    markdown: goalFile.markdown,
    revision: getGoalRevision(goalFile.stats),
  };
}

export async function createGoalMarkdown(
  repositoryPath: string,
  markdown = DEFAULT_GOAL_MARKDOWN,
): Promise<{
  goalPath: string;
  markdown: string;
  revision: string;
}> {
  const goalPath = getGoalFilePath(repositoryPath);

  await assertExistingGoalPathDoesNotEscape(repositoryPath, goalPath);
  try {
    await assertGoalPathIsNotSymlink(goalPath);
  } catch (error) {
    if (!isNodeErrorCode(error, "ENOENT")) {
      throw error;
    }
  }

  await writeFile(goalPath, markdown, {
    encoding: "utf8",
    flag: "wx",
  });
  const goalFileStats = await stat(goalPath);

  return {
    goalPath,
    markdown,
    revision: getGoalRevision(goalFileStats),
  };
}

export async function createDefaultGoalMarkdown(
  repositoryPath: string,
): Promise<{
  goalPath: string;
  markdown: string;
  revision: string;
}> {
  return createGoalMarkdown(repositoryPath);
}

export async function updateGoalMarkdown(
  repositoryPath: string,
  markdown: string,
  expectedRevision: string,
): Promise<{
  goalPath: string;
  markdown: string;
  revision: string;
}> {
  const goalPath = getGoalFilePath(repositoryPath);
  const currentGoalStats = (await readVerifiedGoalFile(repositoryPath, goalPath)).stats;
  const currentRevision = getGoalRevision(currentGoalStats);

  if (currentRevision !== expectedRevision) {
    throw new GoalRevisionMismatchError({
      actualRevision: currentRevision,
      expectedRevision,
    });
  }

  const tempGoalPath = path.join(
    repositoryPath,
    `.goal.md.${process.pid}.${randomUUID()}.tmp`,
  );

  await writeFile(tempGoalPath, markdown, {
    encoding: "utf8",
    flag: "wx",
  });

  try {
    await rename(tempGoalPath, goalPath);
  } catch (error) {
    await rm(tempGoalPath, {
      force: true,
    });
    throw error;
  }

  const updatedGoalStats = await readGoalFileMetadata(repositoryPath, goalPath);

  return {
    goalPath,
    markdown,
    revision: getGoalRevision(updatedGoalStats),
  };
}
