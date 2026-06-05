import DOMPurify from "dompurify";
import { marked } from "marked";

export function renderGoalMarkdown(markdown: string): string {
  const unsafeHtml = marked(markdown, {
    async: false,
    gfm: true,
  });

  return DOMPurify.sanitize(unsafeHtml);
}
