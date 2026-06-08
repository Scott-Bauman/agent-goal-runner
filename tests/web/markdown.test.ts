import { beforeEach, describe, expect, it, vi } from "vitest";

import DOMPurify from "dompurify";

import {
  extractGoalImplementationSteps,
  renderGoalMarkdown,
} from "../../src/web/markdown";

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

describe("extractGoalImplementationSteps", () => {
  it("extracts task-list items from the Implementation Plan section", () => {
    const steps = extractGoalImplementationSteps([
      "# Project Goal",
      "",
      "## Implementation Plan",
      "",
      "### First Pass",
      "",
      "- [ ] Add parser",
      "  - [x] Cover nested task",
      "- [ ] Wire UI",
      "",
      "## Verification",
      "",
      "- [ ] Ignore verification task",
    ].join("\n"));

    expect(steps).toEqual([
      {
        depth: 0,
        id: "goal-implementation-step-0",
        status: "pending",
        text: "Add parser",
      },
      {
        depth: 1,
        id: "goal-implementation-step-1",
        status: "completed",
        text: "Cover nested task",
      },
      {
        depth: 0,
        id: "goal-implementation-step-2",
        status: "pending",
        text: "Wire UI",
      },
    ]);
  });

  it("marks the first unchecked implementation step blocked when the goal is blocked", () => {
    const steps = extractGoalImplementationSteps([
      "# Project Goal",
      "",
      "## Implementation Plan",
      "",
      "- [x] Finished step",
      "- [ ] Current step",
      "- [ ] Later step",
      "",
      "## Blocked / Complete Policy",
      "",
      "GOAL_BLOCKED: waiting on user input.",
    ].join("\n"));

    expect(steps.map((step) => step.status)).toEqual([
      "completed",
      "blocked",
      "pending",
    ]);
  });

  it("does not mark a step blocked when GOAL_BLOCKED appears only in policy text", () => {
    const steps = extractGoalImplementationSteps([
      "# Project Goal",
      "",
      "## Implementation Plan",
      "",
      "- [ ] Current step",
      "",
      "## Blocked / Complete Policy",
      "",
      "- Report blocked runs as `GOAL_BLOCKED` with the exact reason.",
      "- Do not persist `GOAL_BLOCKED` in this file unless requested.",
    ].join("\n"));

    expect(steps).toEqual([
      {
        depth: 0,
        id: "goal-implementation-step-0",
        status: "pending",
        text: "Current step",
      },
    ]);
  });

  it("returns an empty list when no implementation steps exist", () => {
    expect(
      extractGoalImplementationSteps([
        "# Project Goal",
        "",
        "## Implementation Plan",
        "",
        "Describe the work without checkboxes.",
        "",
        "## Verification",
        "",
        "- [ ] Ignore verification task",
      ].join("\n")),
    ).toEqual([]);
  });
});
