import { describe, expect, it } from "vitest";

import {
  extractChangedFiles,
  parseFencedMessage,
  shortenLogPath,
} from "../../../../src/web/components/app/logText";
import { classifyLogMessage } from "../../../../src/web/components/app/logClassification";

describe("log console helpers", () => {
  it.each([
    ["Codex is reading the goal", "agent"],
    ["Updated src/web/App.tsx", "edit"],
    ["npm install", "command"],
    ["npm run typecheck", "verify"],
    ["All tests passed", "done"],
    ["warning: deprecated package", "warn"],
    ["Error: command failed", "error"],
    ["working tree clean", "git"],
  ] as const)("classifies %s as %s", (message, expectedKind) => {
    expect(classifyLogMessage(message)).toBe(expectedKind);
  });

  it("splits fenced code into code sub-block segments", () => {
    expect(
      parseFencedMessage("Before\n```ts\nconst ok = true;\n```\nAfter"),
    ).toEqual([
      {
        text: "Before\n",
        type: "text",
      },
      {
        language: "ts",
        text: "const ok = true;",
        type: "code",
      },
      {
        text: "\nAfter",
        type: "text",
      },
    ]);
  });

  it("shortens Windows absolute paths for primary display", () => {
    expect(
      shortenLogPath(
        "C:\\repo\\agent-goal-runner\\src\\web\\App.tsx",
      ),
    ).toBe("src/web/App.tsx");
  });

  it("extracts compact unique changed-file paths from log text", () => {
    expect(
      extractChangedFiles([
        "Updated C:\\repo\\agent-goal-runner\\src\\web\\App.tsx",
        "Updated src/web/App.tsx and tests/web/events/runtimeStream.test.ts",
        "No file path here",
      ]),
    ).toEqual(["src/web/App.tsx", "tests/web/events/runtimeStream.test.ts"]);
  });
});
