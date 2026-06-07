import { describe, expect, it } from "vitest";

import { classifyLogMessage } from "../../../../src/web/components/app/logClassification";

describe("log console helpers", () => {
  it.each([
    ["npm run typecheck", "command"],
    ["All tests passed", "success"],
    ["warning: deprecated package", "warning"],
    ["Error: command failed", "error"],
    ["working tree clean", "git"],
    ["Verification result changed", "summary"],
    ["Reading src/web/App.tsx", "activity"],
  ] as const)("classifies %s as %s", (message, expectedKind) => {
    expect(classifyLogMessage(message)).toBe(expectedKind);
  });
});
