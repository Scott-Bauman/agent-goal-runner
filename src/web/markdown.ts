import { marked } from "marked";

export function renderGoalMarkdown(markdown: string): string {
  return marked(markdown, {
    async: false,
    gfm: true,
  });
}
