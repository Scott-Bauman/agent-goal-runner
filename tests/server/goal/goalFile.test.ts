import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertResolvedGoalPathInsideRepository,
  createDefaultGoalMarkdown,
  detectGoalStopMarker,
  getGoalFilePath,
  isGoalPathRestrictionError,
  readGoalMarkdown,
} from "../../../src/server/goal/goalFile";
import {
  createEscapingGoalPath,
  createRepositoryPath,
} from "../helpers/tempRepository";
import { useServerTestLifecycle } from "../helpers/lifecycle";

useServerTestLifecycle();

describe("goal stop marker detection", () => {
  it("detects a complete marker", () => {
    expect(detectGoalStopMarker("# Goal\n\nGOAL_COMPLETE\n")).toBe("GOAL_COMPLETE");
  });

  it("detects a blocked marker", () => {
    expect(detectGoalStopMarker("GOAL_BLOCKED: waiting for input")).toBe(
      "GOAL_BLOCKED",
    );
  });

  it("returns null when no stop marker is present", () => {
    expect(detectGoalStopMarker("- [ ] Keep going\n")).toBeNull();
  });

  it("treats blocked as the higher-priority marker when both are present", () => {
    expect(detectGoalStopMarker("GOAL_COMPLETE\n\nGOAL_BLOCKED")).toBe(
      "GOAL_BLOCKED",
    );
  });
});

describe("goal path helpers", () => {
  it("builds goal.md inside the selected repository", async () => {
    const repositoryPath = await createRepositoryPath();

    expect(getGoalFilePath(repositoryPath)).toBe(path.join(repositoryPath, "goal.md"));
  });

  it("reads goal.md only after the resolved path stays inside the repository", async () => {
    const repositoryPath = await createRepositoryPath();
    const goalPath = path.join(repositoryPath, "goal.md");
    await writeFile(goalPath, "# Goal\n", "utf8");

    expect(await readGoalMarkdown(repositoryPath)).toBe("# Goal\n");
  });

  it("creates the default goal.md without overwriting existing files", async () => {
    const repositoryPath = await createRepositoryPath();
    const goalPath = path.join(repositoryPath, "goal.md");

    const createdGoal = await createDefaultGoalMarkdown(repositoryPath);

    expect(createdGoal.goalPath).toBe(goalPath);
    expect(createdGoal.markdown).toContain("# Project Goal");
    await expect(createDefaultGoalMarkdown(repositoryPath)).rejects.toMatchObject({
      code: "EEXIST",
    });
  });

  it("rejects a goal.md path that resolves outside the repository", async () => {
    const repositoryPath = await createRepositoryPath();
    const goalPath = await createEscapingGoalPath(repositoryPath);

    await expect(
      assertResolvedGoalPathInsideRepository(repositoryPath, goalPath),
    ).rejects.toSatisfy(isGoalPathRestrictionError);
  });
});
