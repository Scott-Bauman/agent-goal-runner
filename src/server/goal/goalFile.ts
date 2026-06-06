import { lstat, readFile, realpath, stat, writeFile } from "node:fs/promises";
import type { Stats } from "node:fs";
import path from "node:path";

import { isNodeErrorCode } from "../shared/nodeErrors.js";

export const DEFAULT_GOAL_MARKDOWN = `# Project Goal

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

export class GoalPathRestrictionError extends Error {
  constructor() {
    super("goal.md resolves outside the selected repository.");
    this.name = "GoalPathRestrictionError";
  }
}

export class GoalRevisionMismatchError extends Error {
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

export function isPathInsideDirectory(
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

export async function assertExistingGoalPathDoesNotEscape(
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

export function getGoalRevision(goalFileStats: Stats): string {
  return [
    goalFileStats.mtimeMs.toString(36),
    goalFileStats.size.toString(36),
    goalFileStats.ino.toString(36),
  ].join("-");
}

async function readGoalFileMetadata(
  repositoryPath: string,
  goalFilePath: string,
): Promise<Stats> {
  await assertResolvedGoalPathInsideRepository(repositoryPath, goalFilePath);
  await assertGoalPathIsNotSymlink(goalFilePath);

  return stat(goalFilePath);
}

export async function readGoalMarkdown(repositoryPath: string): Promise<string> {
  const goalFilePath = getGoalFilePath(repositoryPath);

  await readGoalFileMetadata(repositoryPath, goalFilePath);

  return readFile(goalFilePath, "utf8");
}

export async function readGoalMarkdownWithRevision(
  repositoryPath: string,
): Promise<{
  goalPath: string;
  markdown: string;
  revision: string;
}> {
  const goalPath = getGoalFilePath(repositoryPath);
  const goalFileStats = await readGoalFileMetadata(repositoryPath, goalPath);
  const markdown = await readFile(goalPath, "utf8");

  return {
    goalPath,
    markdown,
    revision: getGoalRevision(goalFileStats),
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
  const currentGoalStats = await readGoalFileMetadata(repositoryPath, goalPath);
  const currentRevision = getGoalRevision(currentGoalStats);

  if (currentRevision !== expectedRevision) {
    throw new GoalRevisionMismatchError({
      actualRevision: currentRevision,
      expectedRevision,
    });
  }

  await writeFile(goalPath, markdown, "utf8");
  const updatedGoalStats = await stat(goalPath);

  return {
    goalPath,
    markdown,
    revision: getGoalRevision(updatedGoalStats),
  };
}
