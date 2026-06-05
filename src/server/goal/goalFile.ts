import { readFile, realpath, writeFile } from "node:fs/promises";
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

export function isGoalPathRestrictionError(
  error: unknown,
): error is GoalPathRestrictionError {
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

export async function readGoalMarkdown(repositoryPath: string): Promise<string> {
  const goalFilePath = getGoalFilePath(repositoryPath);

  await assertResolvedGoalPathInsideRepository(repositoryPath, goalFilePath);

  return readFile(goalFilePath, "utf8");
}

export async function createDefaultGoalMarkdown(
  repositoryPath: string,
): Promise<{
  goalPath: string;
  markdown: string;
}> {
  const goalPath = getGoalFilePath(repositoryPath);

  await assertExistingGoalPathDoesNotEscape(repositoryPath, goalPath);
  await writeFile(goalPath, DEFAULT_GOAL_MARKDOWN, {
    encoding: "utf8",
    flag: "wx",
  });

  return {
    goalPath,
    markdown: DEFAULT_GOAL_MARKDOWN,
  };
}
