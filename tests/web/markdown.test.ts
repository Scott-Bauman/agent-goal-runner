import { beforeEach, describe, expect, it, vi } from "vitest";

import DOMPurify from "dompurify";

import { renderGoalMarkdown } from "../../src/web/markdown";

vi.mock("dompurify", () => ({
  default: {
    sanitize: vi.fn((html: string) =>
      html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/\s+on\w+="[^"]*"/gi, ""),
    ),
  },
}));

describe("renderGoalMarkdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it("sanitizes rendered HTML before returning it", () => {
    const html = renderGoalMarkdown([
      "# Project Goal",
      "",
      '<img src="goal.png" onerror="alert(1)">',
      "<script>alert(1)</script>",
    ].join("\n"));

    expect(DOMPurify.sanitize).toHaveBeenCalledOnce();
    expect(html).toContain("<h1>Project Goal</h1>");
    expect(html).toContain('<img src="goal.png">');
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("<script>");
  });
});
