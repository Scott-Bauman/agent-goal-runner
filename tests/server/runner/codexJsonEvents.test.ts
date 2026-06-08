import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CodexJsonEventParser,
  createSkillPreflightStatus,
  extractReferencedSkillNames,
  preferSkillReferenceSyntax,
} from "../../../src/server/runner/codexJsonEvents";

describe("Codex JSON event parsing", () => {
  it("parses JSONL command and file events with metadata", () => {
    const parser = new CodexJsonEventParser();
    const parsed = parser.push(
      [
        JSON.stringify({
          type: "thread.started",
          message: "session abc",
          model: "gpt-5.4",
          config: {
            model_reasoning_effort: "high",
          },
        }),
        JSON.stringify({
          type: "command.started",
          command: "npm test",
        }),
        JSON.stringify({
          type: "command.completed",
          command: "npm test",
          exit_code: 0,
          usage: {
            total_tokens: 1234,
          },
        }),
        JSON.stringify({
          type: "file.changed",
          path: "src/server/runner/runController.ts",
        }),
      ].join("\n") + "\n",
    );

    expect(parsed.events.map((event) => event.kind)).toEqual([
      "codex_session_started",
      "command_started",
      "command_succeeded",
      "file_changed",
    ]);
    expect(parsed.metadata).toMatchObject({
      changedFiles: ["src/server/runner/runController.ts"],
      model: "gpt-5.4",
      reasoningEffort: "high",
      tokenCount: 1234,
    });
  });

  it("deduplicates repeated diff events", () => {
    const parser = new CodexJsonEventParser();
    const diff = "diff --git a/src/web/App.tsx b/src/web/App.tsx\n@@ change";

    const parsed = parser.push(
      `${JSON.stringify({ type: "patch.applied", message: diff })}\n${JSON.stringify({
        type: "patch.applied",
        message: diff,
      })}\n`,
    );

    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]).toMatchObject({
      kind: "patch_applied",
    });
  });

  it("downgrades failed skill path lookups to warnings", () => {
    const parser = new CodexJsonEventParser();
    const parsed = parser.push(
      `${JSON.stringify({
        level: "error",
        message:
          "Failed to load .codex/skills/example/SKILL.md; later loaded .agents/skills/example/SKILL.md",
      })}\n`,
    );

    expect(parsed.events).toEqual([
      {
        kind: "warning",
        message:
          "Failed to load .codex/skills/example/SKILL.md; later loaded .agents/skills/example/SKILL.md",
      },
    ]);
  });

  it("extracts and normalizes explicit skill references", () => {
    expect(preferSkillReferenceSyntax("Use the review skill for this pass.")).toBe(
      "Use $review for this pass.",
    );
    expect(extractReferencedSkillNames("Use $review and Use the debug skill.")).toEqual([
      "debug",
      "review",
    ]);
  });

  it("checks repo-local skill paths without failing missing skills", () => {
    const repositoryPath = "C:\\repo";
    const status = createSkillPreflightStatus(
      repositoryPath,
      "Use $review and $debug.",
      (skillPath) =>
        skillPath ===
        path.join(repositoryPath, ".agents", "skills", "review", "SKILL.md"),
    );

    expect(status).toEqual({
      checked: true,
      found: ["review"],
      missing: ["debug"],
    });
  });
});
