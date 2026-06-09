import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  emptyRequestSchema,
  formatZodIssues,
  validationError,
} from "../../../src/server/shared/validation";

describe("shared validation helpers", () => {
  it("accepts empty request objects and rejects unexpected fields", () => {
    expect(emptyRequestSchema.safeParse({}).success).toBe(true);

    const parsed = emptyRequestSchema.safeParse({
      extra: "value",
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issues = formatZodIssues(parsed.error);

      expect(issues).toHaveLength(1);
      expect(issues[0]?.path).toBe("request");
      expect(issues[0]?.message).toContain("extra");
    }
  });

  it("formats zod issue paths for nested fields and root-level values", () => {
    const schema = z.object({
      repository: z.object({
        path: z.string().min(1),
      }),
    });
    const nested = schema.safeParse({
      repository: {
        path: "",
      },
    });
    const root = z.string().safeParse(123);

    expect(nested.success).toBe(false);
    expect(root.success).toBe(false);

    if (!nested.success && !root.success) {
      expect(formatZodIssues(nested.error)).toEqual([
        {
          path: "repository.path",
          message: "String must contain at least 1 character(s)",
        },
      ]);
      expect(formatZodIssues(root.error)).toEqual([
        {
          path: "request",
          message: "Expected string, received number",
        },
      ]);
    }
  });

  it("builds the API validation error response shape", () => {
    expect(
      validationError("Invalid request.", [
        {
          path: "body.name",
          message: "Required",
        },
      ]),
    ).toEqual({
      error: "Invalid request.",
      code: "VALIDATION_ERROR",
      issues: [
        {
          path: "body.name",
          message: "Required",
        },
      ],
    });
  });
});
