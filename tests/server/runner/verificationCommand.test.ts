import { describe, expect, it } from "vitest";

import { parseVerificationCommand } from "../../../src/server/runner/verificationCommand";

describe("verification command parsing", () => {
  it("treats an empty command as no verification command", () => {
    expect(parseVerificationCommand("   ")).toEqual({
      success: true,
      parsed: null,
    });
  });

  it("parses a direct executable with quoted arguments", () => {
    expect(parseVerificationCommand('npm run "test:unit" -- --grep goal')).toEqual({
      success: true,
      parsed: {
        executable: "npm",
        args: ["run", "test:unit", "--", "--grep", "goal"],
      },
    });
  });

  it.each([
    [
      "npm test && npm run lint",
      "Verification command must use a single executable plus arguments; shell operators are not supported.",
    ],
    [
      'npm run "test',
      "Verification command contains an unterminated quoted argument.",
    ],
    ["sh -c npm test", "Verification command must be a direct executable, not a shell."],
  ])("rejects unsafe command syntax: %s", (command, error) => {
    expect(parseVerificationCommand(command)).toEqual({
      success: false,
      error,
    });
  });
});
