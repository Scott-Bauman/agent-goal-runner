import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  repositorySelectionSchema,
  validateRepositoryPath,
} from "../../../src/server/repository/repositorySelection";
import {
  createRepositoryPath,
  createTempPath,
} from "../helpers/tempRepository";
import { useServerTestLifecycle } from "../helpers/lifecycle";

useServerTestLifecycle();

describe("repository selection helpers", () => {
  it("normalizes an absolute repository path", () => {
    const repositoryPath = path.join(os.tmpdir(), "repo", "..", "repo");

    expect(repositorySelectionSchema.parse({ path: repositoryPath })).toEqual({
      path: path.normalize(repositoryPath),
    });
  });

  it("rejects non-absolute paths before filesystem validation", () => {
    const result = repositorySelectionSchema.safeParse({ path: "relative/repo" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "Path must be an absolute local filesystem path.",
      );
    }
  });

  it("accepts a directory with a git marker", async () => {
    const repositoryPath = await createRepositoryPath();

    await expect(validateRepositoryPath(repositoryPath)).resolves.toBeUndefined();
  });

  it("rejects missing paths, files, and directories without a git marker", async () => {
    const plainDirectory = await createTempPath();
    const filePath = path.join(plainDirectory, "file.txt");
    await writeFile(filePath, "not a repository\n", "utf8");

    await expect(
      validateRepositoryPath(path.join(os.tmpdir(), "codex-goal-runner-missing")),
    ).resolves.toBe("Path must exist.");
    await expect(validateRepositoryPath(filePath)).resolves.toBe(
      "Path must be an existing directory.",
    );
    await expect(validateRepositoryPath(plainDirectory)).resolves.toBe(
      "Path must be a git repository.",
    );
  });
});
