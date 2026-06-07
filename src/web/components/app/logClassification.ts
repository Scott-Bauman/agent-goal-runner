export type LogActivityKind =
  | "activity"
  | "command"
  | "error"
  | "git"
  | "success"
  | "summary"
  | "warning";

export function classifyLogMessage(message: string): LogActivityKind {
  const normalizedMessage = message.toLowerCase();

  if (/\b(error|failed|failure|exception)\b/.test(normalizedMessage)) {
    return "error";
  }

  if (/\b(warning|warn)\b/.test(normalizedMessage)) {
    return "warning";
  }

  if (/\b(passed|success|complete|completed|done)\b/.test(normalizedMessage)) {
    return "success";
  }

  if (/\b(commit|branch|working tree|git)\b/.test(normalizedMessage)) {
    return "git";
  }

  if (/\b(summary|changed|verification|result)\b/.test(normalizedMessage)) {
    return "summary";
  }

  if (
    /\b(npm|pnpm|yarn|git|codex|test|typecheck|lint|build)\b/.test(
      normalizedMessage,
    )
  ) {
    return "command";
  }

  return "activity";
}
