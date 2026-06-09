import { cp, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const skillName = "goal-runner-framework";
const targetRepositoryPath = process.argv[2];

if (!targetRepositoryPath) {
  console.error("Usage: npm run install:skill:repo -- <target-repo>");
  process.exitCode = 1;
} else {
  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const sourceDirectory = path.join(appRoot, "bundled-skills", skillName);
  const targetRepository = path.resolve(targetRepositoryPath);
  let targetStats;

  try {
    targetStats = await stat(targetRepository);
  } catch {
    console.error(`Target repository does not exist: ${targetRepository}`);
    process.exitCode = 1;
  }

  if (targetStats && !targetStats.isDirectory()) {
    throw new Error(`Target repository is not a directory: ${targetRepository}`);
  }

  if (targetStats) {
    const sourceStats = await stat(sourceDirectory);

    if (!sourceStats.isDirectory()) {
      throw new Error(`Bundled skill source is not a directory: ${sourceDirectory}`);
    }

    const destinationDirectory = path.join(
      targetRepository,
      ".agents",
      "skills",
      skillName,
    );

    await mkdir(path.dirname(destinationDirectory), {
      recursive: true,
    });
    await cp(sourceDirectory, destinationDirectory, {
      force: true,
      recursive: true,
    });

    console.log(`Installed ${skillName} skill into ${destinationDirectory}`);
  }
}
