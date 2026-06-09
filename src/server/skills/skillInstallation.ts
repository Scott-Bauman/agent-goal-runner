import { existsSync } from "node:fs";
import { cp, mkdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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

function getBundledSkillDirectory(
  skillName: string,
  appRootPath = process.cwd(),
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
  await copyBundledSkill(
    skillName,
    getRepoLocalSkillDirectory(repositoryPath, skillName),
    options,
  );

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
