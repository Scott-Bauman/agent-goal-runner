import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createMockRunProcess } from "../helpers/process";
import { browseRepository } from "../helpers/repositoryBrowse";
import {
  createRepositoryPath,
  createTempPath,
} from "../helpers/tempRepository";
import { createTestServer } from "../helpers/fastify";
import { useServerTestLifecycle } from "../helpers/lifecycle";

useServerTestLifecycle();

async function createBundledSkillRoot(content = "# Skill\n"): Promise<string> {
  const appRootPath = await createTempPath();
  const skillDirectory = path.join(
    appRootPath,
    "bundled-skills",
    "goal-runner-framework",
  );

  await mkdir(skillDirectory, {
    recursive: true,
  });
  await writeFile(path.join(skillDirectory, "SKILL.md"), content, "utf8");

  return appRootPath;
}

describe("goal-runner-framework skill routes", () => {
  it(
    "reports global and bundled status without a selected repository",
    async () => {
      const skillAppRootPath = await createBundledSkillRoot();
      const skillUserHomePath = await createTempPath();
      const app = await createTestServer({
        skillAppRootPath,
        skillUserHomePath,
      });

      const response = await app.inject({
        method: "GET",
        url: "/api/skills/goal-runner-framework",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        name: "goal-runner-framework",
        repoLocal: false,
        userGlobal: false,
        bundled: true,
        installed: false,
        paths: {
          repoLocal: null,
          bundled: path.join(
            skillAppRootPath,
            "bundled-skills",
            "goal-runner-framework",
            "SKILL.md",
          ),
          userGlobal: path.join(
            skillUserHomePath,
            ".agents",
            "skills",
            "goal-runner-framework",
            "SKILL.md",
          ),
        },
      });
    },
    10_000,
  );

  it("reports repo-local and user-global installs for the selected repository", async () => {
    const skillAppRootPath = await createBundledSkillRoot();
    const skillUserHomePath = await createTempPath();
    const repositoryPath = await createRepositoryPath();

    await mkdir(
      path.join(repositoryPath, ".agents", "skills", "goal-runner-framework"),
      {
        recursive: true,
      },
    );
    await writeFile(
      path.join(
        repositoryPath,
        ".agents",
        "skills",
        "goal-runner-framework",
        "SKILL.md",
      ),
      "# Repo Skill\n",
      "utf8",
    );
    await mkdir(
      path.join(skillUserHomePath, ".agents", "skills", "goal-runner-framework"),
      {
        recursive: true,
      },
    );
    await writeFile(
      path.join(
        skillUserHomePath,
        ".agents",
        "skills",
        "goal-runner-framework",
        "SKILL.md",
      ),
      "# Global Skill\n",
      "utf8",
    );

    const app = await createTestServer({
      skillAppRootPath,
      skillUserHomePath,
    });

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "GET",
      url: "/api/skills/goal-runner-framework",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      repoLocal: true,
      userGlobal: true,
      bundled: true,
      installed: true,
    });
  });

  it("installs the bundled skill into the selected repository", async () => {
    const skillAppRootPath = await createBundledSkillRoot("# Bundled Skill\n");
    const skillUserHomePath = await createTempPath();
    const repositoryPath = await createRepositoryPath();
    const app = await createTestServer({
      skillAppRootPath,
      skillUserHomePath,
    });

    await browseRepository(app, repositoryPath);

    const response = await app.inject({
      method: "POST",
      url: "/api/skills/goal-runner-framework/install/repo",
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      repoLocal: true,
      installed: true,
    });
    await expect(
      readFile(
        path.join(
          repositoryPath,
          ".agents",
          "skills",
          "goal-runner-framework",
          "SKILL.md",
        ),
        "utf8",
      ),
    ).resolves.toBe("# Bundled Skill\n");
  });

  it("installs the bundled skill globally", async () => {
    const skillAppRootPath = await createBundledSkillRoot("# Bundled Skill\n");
    const skillUserHomePath = await createTempPath();
    const app = await createTestServer({
      skillAppRootPath,
      skillUserHomePath,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/skills/goal-runner-framework/install/global",
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      userGlobal: true,
      installed: true,
    });
    await expect(
      readFile(
        path.join(
          skillUserHomePath,
          ".agents",
          "skills",
          "goal-runner-framework",
          "SKILL.md",
        ),
        "utf8",
      ),
    ).resolves.toBe("# Bundled Skill\n");
  });

  it("rejects repo-local install while a run is active", async () => {
    const skillAppRootPath = await createBundledSkillRoot();
    const skillUserHomePath = await createTempPath();
    const repositoryPath = await createRepositoryPath();
    const runProcess = createMockRunProcess();
    const spawnProcess = vi.fn(() => runProcess);
    const app = await createTestServer({
      skillAppRootPath,
      skillUserHomePath,
      spawnProcess,
    });

    await browseRepository(app, repositoryPath);
    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/skills/goal-runner-framework/install/repo",
      payload: {},
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "Cannot install repo-local skill while a run is active.",
    });
  });

  it("rejects global install while a run is active", async () => {
    const skillAppRootPath = await createBundledSkillRoot();
    const skillUserHomePath = await createTempPath();
    const repositoryPath = await createRepositoryPath();
    const runProcess = createMockRunProcess();
    const spawnProcess = vi.fn(() => runProcess);
    const app = await createTestServer({
      skillAppRootPath,
      skillUserHomePath,
      spawnProcess,
    });

    await browseRepository(app, repositoryPath);
    await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        prompt: "Use goal.md as the source of truth.",
        runCount: 1,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/skills/goal-runner-framework/install/global",
      payload: {},
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "Cannot install global skill while a run is active.",
    });
  });
});
