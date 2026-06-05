import { describe, expect, it } from "vitest";

import { renderGoalMarkdown } from "../../src/web/markdown";

describe("renderGoalMarkdown", () => {
  it("converts goal markdown to HTML with marked", () => {
    const html = renderGoalMarkdown([
      "# Project Goal",
      "",
      "Build **codex-goal-runner**.",
      "",
      "- [x] Read goal.md",
    ].join("\n"));

    expect(html).toContain("<h1>Project Goal</h1>");
    expect(html).toContain("<strong>codex-goal-runner</strong>");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("checked");
  });
});
