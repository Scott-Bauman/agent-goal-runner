import { z } from "zod";

export const emptyRequestSchema = z.object({}).strict();

export type ValidationIssue = {
  path: string;
  message: string;
};

type ParsedRequestPart = { success: true } | { success: false; error: z.ZodError };

export function formatZodIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join(".") || "request",
    message: issue.message,
  }));
}

export function formatParsedRequestIssues(
  ...parts: ParsedRequestPart[]
): ValidationIssue[] {
  return parts.flatMap((part) =>
    part.success ? [] : formatZodIssues(part.error),
  );
}

export function formatEmptyRequestIssues(
  query: unknown,
  body: unknown,
): ValidationIssue[] {
  return formatParsedRequestIssues(
    emptyRequestSchema.safeParse(query),
    emptyRequestSchema.safeParse(body ?? {}),
  );
}

export function validationError(
  error: string,
  issues: ValidationIssue[],
): {
  error: string;
  code: "VALIDATION_ERROR";
  issues: ValidationIssue[];
} {
  return {
    error,
    code: "VALIDATION_ERROR",
    issues,
  };
}
