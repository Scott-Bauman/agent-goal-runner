import { cp, mkdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const skillName = "goal-runner-framework";
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = path.join(appRoot, "bundled-skills", skillName);
const destinationDirectory = path.join(
  os.homedir(),
  ".agents",
  "skills",
  skillName,
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

console.log(`Installed ${skillName} skill globally at ${destinationDirectory}`);
