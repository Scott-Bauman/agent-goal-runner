import { stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { isNodeErrorCode } from "../shared/nodeErrors.js";

export const repositorySelectionSchema = z
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

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return false;
    }

    throw error;
  }
}

export async function validateRepositoryPath(
  repositoryPath: string,
): Promise<string | undefined> {
  let pathStats;

  try {
    pathStats = await stat(repositoryPath);
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
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
