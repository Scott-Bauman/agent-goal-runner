import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  CODEX_MODELS,
  CODEX_REASONING_EFFORTS,
} from "../runner/codexOptions.js";
import { ACTIVE_RUN_STATUSES } from "../runner/statuses.js";
import { parseVerificationCommand } from "../runner/verificationCommand.js";
import type { ParsedVerificationCommand } from "../runner/verificationCommand.js";
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
    verificationCommands: z
      .array(
        z.string({
          invalid_type_error: "Verification command must be a string.",
        }),
        {
          invalid_type_error: "Verification commands must be an array.",
        },
      )
      .default([])
      .superRefine((commands, context) => {
        commands.forEach((command, index) => {
          const parsedCommand = parseVerificationCommand(command.trim());

          if (!parsedCommand.success) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: parsedCommand.error,
              path: [index],
            });
          }
        });
      })
      .transform((commands) =>
        commands
          .map((command) => command.trim())
          .filter((command) => command.length > 0),
      ),
    runCount: z
      .number({
        invalid_type_error: "Run count must be a number.",
        required_error: "Run count is required.",
      })
      .int("Run count must be a whole number.")
      .min(1, "Run count must be at least 1.")
      .max(100, "Run count must be at most 100."),
    model: z.enum(CODEX_MODELS).nullable().default(null),
    reasoningEffort: z.enum(CODEX_REASONING_EFFORTS).nullable().default(null),
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
    const {
      prompt,
      runCount,
      verificationCommands,
      autoCommit,
      model,
      reasoningEffort,
    } = parsedBody.data;
    const verificationCommandsToRun: ParsedVerificationCommand[] = [];

    for (const verificationCommand of verificationCommands) {
      const verificationCommandParse = parseVerificationCommand(verificationCommand);

      if (!verificationCommandParse.success || !verificationCommandParse.parsed) {
        return reply.code(400).send(
          validationError("Invalid run start request.", [
            {
              path: "verificationCommands",
              message: verificationCommandParse.success
                ? "Verification command must include an executable."
                : verificationCommandParse.error,
            },
          ]),
        );
      }

      verificationCommandsToRun.push(verificationCommandParse.parsed);
    }

    context.runController.start({
      repositoryPath,
      prompt,
      runCount,
      verificationCommandsToRun,
      autoCommit,
      model,
      reasoningEffort,
    });

    return reply.code(202).send({
      status: context.runtimeState.stream.runLoop.status,
      repositoryPath,
      prompt,
      runCount,
      verificationCommands,
      autoCommit,
      model,
      reasoningEffort,
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
