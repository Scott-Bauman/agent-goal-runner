import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { ACTIVE_RUN_STATUSES } from "../runner/statuses.js";
import { parseVerificationCommand } from "../runner/verificationCommand.js";
import type { ServerRuntimeContext } from "../shared/runtime.js";
import {
  emptyRequestSchema,
  formatZodIssues,
  validationError,
} from "../shared/validation.js";

const runStartSchema = z
  .object({
    prompt: z.string().trim().min(1, "Prompt is required."),
    autoCommit: z
      .boolean({
        invalid_type_error: "Auto-commit toggle must be a boolean.",
      })
      .default(false),
    verificationCommand: z
      .string({
        invalid_type_error: "Verification command must be a string.",
      })
      .trim()
      .default("")
      .superRefine((value, context) => {
        const parsedCommand = parseVerificationCommand(value);

        if (!parsedCommand.success) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: parsedCommand.error,
          });
        }
      }),
    runCount: z
      .number({
        invalid_type_error: "Run count must be a number.",
        required_error: "Run count is required.",
      })
      .int("Run count must be a whole number.")
      .min(1, "Run count must be at least 1.")
      .max(100, "Run count must be at most 100."),
  })
  .strict();

export function registerRunRoutes(
  server: FastifyInstance,
  context: ServerRuntimeContext,
): void {
  server.post("/api/run/start", async (request, reply) => {
    const parsedBody = runStartSchema.safeParse(request.body);

    if (!parsedBody.success) {
      return reply
        .code(400)
        .send(
          validationError("Invalid run start request.", formatZodIssues(parsedBody.error)),
        );
    }

    if (!context.runtimeState.selectedRepositoryPath) {
      return reply.code(409).send({
        error: "No repository selected.",
      });
    }

    if (ACTIVE_RUN_STATUSES.has(context.runtimeState.stream.runLoop.status)) {
      return reply.code(409).send({
        error: "A run is already active.",
      });
    }

    const repositoryPath = context.runtimeState.selectedRepositoryPath;
    const { prompt, runCount, verificationCommand, autoCommit } = parsedBody.data;
    const verificationCommandParse = parseVerificationCommand(verificationCommand);

    if (!verificationCommandParse.success) {
      return reply.code(400).send(
        validationError("Invalid run start request.", [
          {
            path: "verificationCommand",
            message: verificationCommandParse.error,
          },
        ]),
      );
    }

    context.runController.start({
      repositoryPath,
      prompt,
      runCount,
      verificationCommandToRun: verificationCommandParse.parsed,
      autoCommit,
    });

    return reply.code(202).send({
      status: context.runtimeState.stream.runLoop.status,
      repositoryPath,
      prompt,
      runCount,
      verificationCommand,
      autoCommit,
    });
  });

  server.post("/api/run/stop", async (request, reply) => {
    const parsedQuery = emptyRequestSchema.safeParse(request.query);
    const parsedBody = emptyRequestSchema.safeParse(request.body ?? {});

    if (!parsedQuery.success || !parsedBody.success) {
      return reply.code(400).send(
        validationError("Invalid run stop request.", [
          ...(!parsedQuery.success ? formatZodIssues(parsedQuery.error) : []),
          ...(!parsedBody.success ? formatZodIssues(parsedBody.error) : []),
        ]),
      );
    }

    if (!context.runController.hasActiveProcess()) {
      return reply.code(409).send({
        error: "No active run to stop.",
      });
    }

    const killSignalSent = context.runController.requestStop();

    return reply.code(202).send({
      status: context.runtimeState.stream.runLoop.status,
      activeProcessId: context.runtimeState.stream.runLoop.activeProcessId,
      killSignalSent,
    });
  });
}
