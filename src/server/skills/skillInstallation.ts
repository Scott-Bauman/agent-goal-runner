import { existsSync } from "node:fs";
import { cp, lstat, mkdir, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const GOAL_RUNNER_SKILL_NAME = "goal-runner-framework";

export type SkillInstallLocationPaths = {
  repoLocal: string | null;
  userGlobal: string;
  bundled: string;
};

export type SkillInstallStatus = {
  name: string;
  repoLocal: boolean;
  userGlobal: boolean;
  bundled: boolean;
  installed: boolean;
  paths: SkillInstallLocationPaths;
};

export type SkillPathOptions = {
  appRootPath?: string;
  repositoryPath: string | null;
  skillExists?: (skillPath: string) => boolean;
  userHomePath?: string;
};

type SkillCopyOptions = {
  appRootPath?: string;
  userHomePath?: string;
};

class SkillInstallPathRestrictionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillInstallPathRestrictionError";
  }
}

function getRepoLocalSkillDirectory(
  repositoryPath: string,
  skillName: string,
): string {
  return path.join(repositoryPath, ".agents", "skills", skillName);
}

function getUserGlobalSkillDirectory(
  skillName: string,
  userHomePath = os.homedir(),
): string {
  return path.join(userHomePath, ".agents", "skills", skillName);
}

function getDefaultAppRootPath(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
  );
}

function getBundledSkillDirectory(
  skillName: string,
  appRootPath = getDefaultAppRootPath(),
): string {
  return path.join(appRootPath, "bundled-skills", skillName);
}

function getSkillFilePath(skillDirectory: string): string {
  return path.join(skillDirectory, "SKILL.md");
}

export function getSkillInstallStatus(
  skillName: string,
  options: SkillPathOptions,
): SkillInstallStatus {
  const skillExists = options.skillExists ?? existsSync;
  const repoLocalDirectory = options.repositoryPath
    ? getRepoLocalSkillDirectory(options.repositoryPath, skillName)
    : null;
  const userGlobalDirectory = getUserGlobalSkillDirectory(
    skillName,
    options.userHomePath,
  );
  const bundledDirectory = getBundledSkillDirectory(
    skillName,
    options.appRootPath,
  );
  const paths: SkillInstallLocationPaths = {
    repoLocal: repoLocalDirectory ? getSkillFilePath(repoLocalDirectory) : null,
    userGlobal: getSkillFilePath(userGlobalDirectory),
    bundled: getSkillFilePath(bundledDirectory),
  };
  const repoLocal = paths.repoLocal ? skillExists(paths.repoLocal) : false;
  const userGlobal = skillExists(paths.userGlobal);

  return {
    name: skillName,
    repoLocal,
    userGlobal,
    bundled: skillExists(paths.bundled),
    installed: repoLocal || userGlobal,
    paths,
  };
}

export async function copyBundledSkillToRepository(
  skillName: string,
  repositoryPath: string,
  options: SkillCopyOptions = {},
): Promise<SkillInstallStatus> {
  const repositoryRoot = await realpath(repositoryPath);
  const destinationDirectory = getRepoLocalSkillDirectory(
    repositoryRoot,
    skillName,
  );

  await assertSafeRepoLocalSkillDestination(repositoryRoot, destinationDirectory);
  await copyBundledSkill(
    skillName,
    destinationDirectory,
    options,
  );
  await assertSafeRepoLocalSkillDestination(repositoryRoot, destinationDirectory);

  return getSkillInstallStatus(skillName, {
    appRootPath: options.appRootPath,
    repositoryPath,
    userHomePath: options.userHomePath,
  });
}

export async function copyBundledSkillToUserGlobal(
  skillName: string,
  repositoryPath: string | null,
  options: SkillCopyOptions = {},
): Promise<SkillInstallStatus> {
  await copyBundledSkill(
    skillName,
    getUserGlobalSkillDirectory(skillName, options.userHomePath),
    options,
  );

  return getSkillInstallStatus(skillName, {
    appRootPath: options.appRootPath,
    repositoryPath,
    userHomePath: options.userHomePath,
  });
}

async function copyBundledSkill(
  skillName: string,
  destinationDirectory: string,
  options: SkillCopyOptions,
): Promise<void> {
  const sourceDirectory = getBundledSkillDirectory(
    skillName,
    options.appRootPath,
  );
  const sourceStats = await stat(sourceDirectory);

  if (!sourceStats.isDirectory()) {
    throw new Error(`Bundled skill source is not a directory: ${sourceDirectory}`);
  }

  await mkdir(path.dirname(destinationDirectory), {
    recursive: true,
  });
  await cp(sourceDirectory, destinationDirectory, {
    force: true,
    recursive: true,
  });
}

function isPathInsideDirectory(
  directoryPath: string,
  targetPath: string,
): boolean {
  const relativePath = path.relative(directoryPath, targetPath);

  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

async function assertNoExistingPathComponentIsLink(
  rootPath: string,
  targetPath: string,
): Promise<void> {
  const relativePath = path.relative(rootPath, targetPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new SkillInstallPathRestrictionError(
      "Repo-local skill destination resolves outside the selected repository.",
    );
  }

  let currentPath = rootPath;

  for (const part of relativePath.split(path.sep).filter(Boolean)) {
    currentPath = path.join(currentPath, part);

    try {
      const stats = await lstat(currentPath);

      if (stats.isSymbolicLink()) {
        throw new SkillInstallPathRestrictionError(
          "Repo-local skill destination must not include symlinks or junctions.",
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }

      throw error;
    }
  }
}

async function assertSafeRepoLocalSkillDestination(
  repositoryPath: string,
  destinationDirectory: string,
): Promise<void> {
  const repositoryRoot = await realpath(repositoryPath);
  const parentDirectory = path.dirname(destinationDirectory);

  await assertNoExistingPathComponentIsLink(repositoryRoot, parentDirectory);
  await mkdir(parentDirectory, {
    recursive: true,
  });
  await assertNoExistingPathComponentIsLink(repositoryRoot, parentDirectory);

  try {
    await assertNoExistingPathComponentIsLink(repositoryRoot, destinationDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const resolvedParent = await realpath(parentDirectory);

  if (!isPathInsideDirectory(repositoryRoot, resolvedParent)) {
    throw new SkillInstallPathRestrictionError(
      "Repo-local skill destination resolves outside the selected repository.",
    );
  }
}
