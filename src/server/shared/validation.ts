import { z } from "zod";

export const emptyRequestSchema = z.object({}).strict();

export type ValidationIssue = {
  path: string;
  message: string;
};

export function formatZodIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join(".") || "request",
    message: issue.message,
  }));
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
