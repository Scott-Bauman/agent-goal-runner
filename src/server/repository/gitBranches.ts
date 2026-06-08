import type { ProcessSpawner } from "../shared/process.js";

export type RepositoryBranches = {
  currentBranch: string | null;
  branches: string[];
};

export type GitCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

export class GitCommandError extends Error {
  constructor(
    message: string,
    readonly result: GitCommandResult | null = null,
  ) {
    super(message);
    this.name = "GitCommandError";
  }
}

export async function getRepositoryBranches(
  spawnProcess: ProcessSpawner,
  repositoryPath: string,
): Promise<RepositoryBranches> {
  const [currentBranchResult, branchesResult] = await Promise.all([
    runGitCommand(spawnProcess, repositoryPath, ["branch", "--show-current"]),
    runGitCommand(spawnProcess, repositoryPath, [
      "branch",
      "--format=%(refname:short)",
    ]),
  ]);

  const currentBranch = currentBranchResult.stdout.trim() || null;
  const branches = Array.from(
    new Set(
      branchesResult.stdout
        .split(/\r?\n/)
        .map((branch) => branch.trim())
        .filter((branch) => branch.length > 0),
    ),
  ).sort((first, second) => first.localeCompare(second));

  return {
    currentBranch,
    branches,
  };
}

export async function switchRepositoryBranch(
  spawnProcess: ProcessSpawner,
  repositoryPath: string,
  branch: string,
): Promise<RepositoryBranches> {
  await runGitCommand(spawnProcess, repositoryPath, ["switch", branch]);

  return getRepositoryBranches(spawnProcess, repositoryPath);
}

export async function createRepositoryBranch(
  spawnProcess: ProcessSpawner,
  repositoryPath: string,
  branchName: string,
): Promise<RepositoryBranches> {
  await runGitCommand(spawnProcess, repositoryPath, ["switch", "-c", branchName]);

  return getRepositoryBranches(spawnProcess, repositoryPath);
}

export async function validateRepositoryBranchName(
  spawnProcess: ProcessSpawner,
  repositoryPath: string,
  branchName: string,
): Promise<void> {
  await runGitCommand(spawnProcess, repositoryPath, [
    "check-ref-format",
    "--branch",
    branchName,
  ]);
}

export function getGitErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof GitCommandError)) {
    return fallback;
  }

  const stderr = error.result?.stderr.trim();
  const stdout = error.result?.stdout.trim();

  return stderr || stdout || error.message || fallback;
}

async function runGitCommand(
  spawnProcess: ProcessSpawner,
  repositoryPath: string,
  args: string[],
): Promise<GitCommandResult> {
  return new Promise((resolve, reject) => {
    const childProcess = spawnProcess("git", args, {
      cwd: repositoryPath,
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    childProcess.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    childProcess.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });
    childProcess.on("error", (error) => {
      reject(new GitCommandError(error.message));
    });
    childProcess.on("close", (exitCode) => {
      const result = {
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode,
      };

      if (exitCode === 0) {
        resolve(result);
        return;
      }

      reject(
        new GitCommandError(
          `git ${args.join(" ")} failed with exit code ${exitCode ?? "unknown"}.`,
          result,
        ),
      );
    });
  });
}
