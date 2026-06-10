import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertResolvedGoalPathInsideRepository,
  createGoalMarkdown,
  createDefaultGoalMarkdown,
  detectGoalStopMarker,
  getGoalFilePath,
  isGoalPathRestrictionError,
  isGoalRevisionMismatchError,
  readGoalMarkdown,
  readGoalMarkdownWithRevision,
  updateGoalMarkdown,
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

  it("ignores marker names mentioned in prose", () => {
    expect(
      detectGoalStopMarker(
        [
          "## Stop Conditions",
          "",
          "- The refreshed `goal.md` contains `GOAL_COMPLETE`.",
          "- The refreshed `goal.md` contains `GOAL_BLOCKED`.",
          "",
          "## Blocked / Complete Policy",
          "",
          "- Report blocked runs as `GOAL_BLOCKED` with the exact reason.",
          "- Add `GOAL_COMPLETE` only when every required checkbox is complete.",
        ].join("\n"),
      ),
    ).toBeNull();
  });

  it("detects a complete marker when blocked is only mentioned in policy text", () => {
    expect(
      detectGoalStopMarker(
        [
          "## Blocked / Complete Policy",
          "",
          "- Report blocked runs as `GOAL_BLOCKED` with the exact reason.",
          "- Do not persist `GOAL_BLOCKED` in this file unless explicitly asked.",
          "",
          "GOAL_COMPLETE",
        ].join("\n"),
      ),
    ).toBe("GOAL_COMPLETE");
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
    expect(createdGoal.revision).toEqual(expect.any(String));
    await expect(createDefaultGoalMarkdown(repositoryPath)).rejects.toMatchObject({
      code: "EEXIST",
    });
  });

  it("creates goal.md with caller-provided markdown", async () => {
    const repositoryPath = await createRepositoryPath();
    const goalPath = path.join(repositoryPath, "goal.md");
    const markdown = "# Manual Goal\n";

    const createdGoal = await createGoalMarkdown(repositoryPath, markdown);

    expect(createdGoal).toEqual({
      goalPath,
      markdown,
      revision: expect.any(String),
    });
    expect(await readGoalMarkdown(repositoryPath)).toBe(markdown);
  });

  it("updates goal.md only when the expected revision matches", async () => {
    const repositoryPath = await createRepositoryPath();
    const goalPath = path.join(repositoryPath, "goal.md");
    await writeFile(goalPath, "# Old Goal\n", "utf8");
    const goalFile = await readGoalMarkdownWithRevision(repositoryPath);
    const markdown = "# New Goal\n\n- [ ] Next\n";

    const updatedGoal = await updateGoalMarkdown(
      repositoryPath,
      markdown,
      goalFile.revision,
    );

    expect(updatedGoal).toEqual({
      goalPath,
      markdown,
      revision: expect.any(String),
    });
    expect(updatedGoal.revision).not.toBe(goalFile.revision);
    expect(await readGoalMarkdown(repositoryPath)).toBe(markdown);
  });

  it("rejects updates with stale revisions", async () => {
    const repositoryPath = await createRepositoryPath();
    const goalPath = path.join(repositoryPath, "goal.md");
    await writeFile(goalPath, "# Old Goal\n", "utf8");
    const goalFile = await readGoalMarkdownWithRevision(repositoryPath);
    await writeFile(goalPath, "# Changed Elsewhere\n", "utf8");

    await expect(
      updateGoalMarkdown(repositoryPath, "# New Goal\n", goalFile.revision),
    ).rejects.toSatisfy(isGoalRevisionMismatchError);
    expect(await readGoalMarkdown(repositoryPath)).toBe("# Changed Elsewhere\n");
  });

  it("rejects a goal.md path that resolves outside the repository", async () => {
    const repositoryPath = await createRepositoryPath();
    const goalPath = await createEscapingGoalPath(repositoryPath);

    await expect(
      assertResolvedGoalPathInsideRepository(repositoryPath, goalPath),
    ).rejects.toSatisfy(isGoalPathRestrictionError);
  });

  it("rejects reading a symlinked goal.md", async () => {
    const repositoryPath = await createRepositoryPath();

    await createEscapingGoalPath(repositoryPath);

    await expect(readGoalMarkdown(repositoryPath)).rejects.toSatisfy(
      isGoalPathRestrictionError,
    );
  });

  it("rejects updating a symlinked goal.md", async () => {
    const repositoryPath = await createRepositoryPath();

    await createEscapingGoalPath(repositoryPath);

    await expect(
      updateGoalMarkdown(repositoryPath, "# New Goal\n", "revision"),
    ).rejects.toSatisfy(isGoalPathRestrictionError);
  });
});
