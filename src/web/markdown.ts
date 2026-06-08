import DOMPurify from "dompurify";
import { marked, type Token, type Tokens } from "marked";

export type GoalImplementationStepStatus = "pending" | "completed" | "blocked";

export type GoalImplementationStep = {
  depth: number;
  id: string;
  status: GoalImplementationStepStatus;
  text: string;
};

type ParsedGoalTaskItem = {
  checked: boolean;
  depth: number;
  text: string;
};

const GOAL_BLOCKED_MARKER_PATTERN = /^GOAL_BLOCKED(?::|\s*$)/;
const IMPLEMENTATION_PLAN_HEADING = "implementation plan";

export function renderGoalMarkdown(markdown: string): string {
  const unsafeHtml = marked(markdown, {
    async: false,
    gfm: true,
  });

  return DOMPurify.sanitize(unsafeHtml);
}

export function extractGoalImplementationSteps(
  markdown: string,
): GoalImplementationStep[] {
  const sectionTokens = getImplementationPlanTokens(
    marked.lexer(markdown, {
      gfm: true,
    }),
  );
  const taskItems = sectionTokens.flatMap((token) =>
    isListToken(token) ? extractTaskItemsFromList(token, 0) : [],
  );
  const blockedStepIndex = isGoalBlockedOnFinalLine(markdown)
    ? taskItems.findIndex((item) => !item.checked)
    : -1;

  return taskItems.map((item, index) => ({
    depth: item.depth,
    id: `goal-implementation-step-${index}`,
    status:
      index === blockedStepIndex
        ? "blocked"
        : item.checked
          ? "completed"
          : "pending",
    text: item.text,
  }));
}

function getImplementationPlanTokens(tokens: Token[]): Token[] {
  const sectionTokens: Token[] = [];
  let isInsideImplementationPlan = false;

  for (const token of tokens) {
    if (token.type === "heading") {
      if (
        token.depth === 2 &&
        normalizeHeadingText(token.text) === IMPLEMENTATION_PLAN_HEADING
      ) {
        isInsideImplementationPlan = true;
        continue;
      }

      if (isInsideImplementationPlan && token.depth <= 2) {
        break;
      }
    }

    if (isInsideImplementationPlan) {
      sectionTokens.push(token);
    }
  }

  return sectionTokens;
}

function extractTaskItemsFromList(
  listToken: Tokens.List,
  depth: number,
): ParsedGoalTaskItem[] {
  return listToken.items.flatMap((item) => {
    const nestedTasks = item.tokens.flatMap((token) =>
      isListToken(token) ? extractTaskItemsFromList(token, depth + 1) : [],
    );

    if (!item.task) {
      return nestedTasks;
    }

    return [
      {
        checked: Boolean(item.checked),
        depth,
        text: extractListItemText(item),
      },
      ...nestedTasks,
    ];
  });
}

function isListToken(token: Token): token is Tokens.List {
  return token.type === "list" && "items" in token && Array.isArray(token.items);
}

function isGoalBlockedOnFinalLine(markdown: string): boolean {
  const finalLine = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);

  return finalLine ? GOAL_BLOCKED_MARKER_PATTERN.test(finalLine) : false;
}

function extractListItemText(item: Tokens.ListItem): string {
  return item.tokens
    .filter((token) => token.type !== "list")
    .map((token) => extractTokenText(token))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTokenText(token: Token): string {
  if ("tokens" in token && Array.isArray(token.tokens)) {
    return token.tokens.map((childToken) => extractTokenText(childToken)).join("");
  }

  if ("text" in token && typeof token.text === "string") {
    return token.text;
  }

  return "";
}

function normalizeHeadingText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}
