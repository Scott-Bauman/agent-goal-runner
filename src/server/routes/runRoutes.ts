import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  AGENT_PROVIDERS,
  DEFAULT_AGENT_PROVIDER,
} from "../runner/agentProviders.js";
import type { AgentProvider } from "../runner/agentProviders.js";
import { CLAUDE_MODELS } from "../runner/claudeOptions.js";
import {
  CODEX_MODELS,
  CODEX_REASONING_EFFORTS,
} from "../runner/codexOptions.js";
import {
  DEFAULT_REVIEW_RUN_OPTIONS,
  DEFAULT_VERIFICATION_FAILURE_OPTIONS,
} from "../runner/runController.js";
import { parseVerificationCommand } from "../runner/verificationCommand.js";
import type { ParsedVerificationCommand } from "../runner/verificationCommand.js";
import type { ServerRuntimeContext } from "../shared/runtime.js";
import {
  formatEmptyRequestIssues,
  formatZodIssues,
  validationError,
} from "../shared/validation.js";
import { getRepositoryPathForInactiveRun } from "./routeGuards.js";

const piModelSchema = z
  .string()
  .trim()
  .transform((model) => (model.length > 0 ? model : null))
  .nullable()
  .default(null);

const disabledReviewSchema = z
  .object({
    enabled: z.literal(false),
  })
  .strict();

const enabledReviewSchema = z
  .object({
    enabled: z.literal(true),
    provider: z.enum(AGENT_PROVIDERS).default(DEFAULT_AGENT_PROVIDER),
    intervalCommits: z
      .number({
        invalid_type_error: "Review interval must be a number.",
        required_error: "Review interval is required.",
      })
      .int("Review interval must be a whole number.")
      .min(1, "Review interval must be at least 1.")
      .max(100, "Review interval must be at most 100."),
    prompt: z.string().trim().min(1, "Review prompt is required."),
    model: z.enum(CODEX_MODELS).nullable().default(null),
    reasoningEffort: z.enum(CODEX_REASONING_EFFORTS).nullable().default(null),
    claudeModel: z.enum(CLAUDE_MODELS).nullable().default(null),
    piModel: piModelSchema,
  })
  .strict();

const reviewSchema = z
  .discriminatedUnion("enabled", [enabledReviewSchema, disabledReviewSchema])
  .default({
    enabled: false,
  });

const verificationFailureSchema = z
  .discriminatedUnion("action", [
    z
      .object({
        action: z.literal("stop"),
      })
      .strict(),
    z
      .object({
        action: z.literal("repair"),
        maxRepairAttempts: z
          .number({
            invalid_type_error: "Repair attempts must be a number.",
            required_error: "Repair attempts are required.",
          })
          .int("Repair attempts must be a whole number.")
          .min(1, "Repair attempts must be at least 1.")
          .max(10, "Repair attempts must be at most 10."),
      })
      .strict(),
  ])
  .default(DEFAULT_VERIFICATION_FAILURE_OPTIONS);

const runStartSchema = z
  .object({
    provider: z.enum(AGENT_PROVIDERS).default(DEFAULT_AGENT_PROVIDER),
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
    claudeModel: z.enum(CLAUDE_MODELS).nullable().default(null),
    piModel: piModelSchema,
    review: reviewSchema,
    verificationFailure: verificationFailureSchema,
  })
  .strict()
  .superRefine((requestBody, context) => {
    addProviderSettingIssues(requestBody, context);

    if (requestBody.review.enabled) {
      addProviderSettingIssues(requestBody.review, context, ["review"]);
    }

    if (requestBody.review.enabled && !requestBody.autoCommit) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Review requires auto-commit to be enabled.",
        path: ["review"],
      });
    }
  });

function addProviderSettingIssues(
  requestBody: {
    claudeModel: unknown;
    model: unknown;
    piModel: unknown;
    provider: AgentProvider;
    reasoningEffort: unknown;
  },
  context: z.RefinementCtx,
  pathPrefix: string[] = [],
): void {
  if (requestBody.provider === "claude") {
    if (requestBody.model !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Codex model is only supported when provider is codex.",
        path: [...pathPrefix, "model"],
      });
    }

    if (requestBody.reasoningEffort !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Codex reasoning effort is only supported when provider is codex.",
        path: [...pathPrefix, "reasoningEffort"],
      });
    }

    if (requestBody.piModel !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Pi model is only supported when provider is pi.",
        path: [...pathPrefix, "piModel"],
      });
    }

    return;
  }

  if (requestBody.provider === "pi") {
    if (requestBody.model !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Codex model is only supported when provider is codex.",
        path: [...pathPrefix, "model"],
      });
    }

    if (requestBody.reasoningEffort !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Codex reasoning effort is only supported when provider is codex.",
        path: [...pathPrefix, "reasoningEffort"],
      });
    }

    if (requestBody.claudeModel !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Claude model is only supported when provider is claude.",
        path: [...pathPrefix, "claudeModel"],
      });
    }

    return;
  }

  if (requestBody.claudeModel !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Claude model is only supported when provider is claude.",
      path: [...pathPrefix, "claudeModel"],
    });
  }

  if (requestBody.piModel !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Pi model is only supported when provider is pi.",
      path: [...pathPrefix, "piModel"],
    });
  }
}

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

    const repositoryPath = getRepositoryPathForInactiveRun(
      context,
      reply,
      "A run is already active.",
    );

    if (!repositoryPath) {
      return;
    }
    const {
      prompt,
      provider,
      runCount,
      verificationCommands,
      autoCommit,
      model,
      reasoningEffort,
      claudeModel,
      piModel,
      review: parsedReview,
      verificationFailure,
    } = parsedBody.data;
    const review = parsedReview.enabled ? parsedReview : DEFAULT_REVIEW_RUN_OPTIONS;
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
      provider,
      prompt,
      runCount,
      verificationCommandsToRun,
      autoCommit,
      model,
      reasoningEffort,
      claudeModel,
      piModel,
      review,
      verificationFailure,
    });

    return reply.code(202).send({
      status: context.runtimeState.stream.runLoop.status,
      repositoryPath,
      provider,
      prompt,
      runCount,
      verificationCommands,
      autoCommit,
      model,
      reasoningEffort,
      claudeModel,
      piModel,
      review,
      verificationFailure,
    });
  });

  server.post("/api/run/stop", async (request, reply) => {
    const requestIssues = formatEmptyRequestIssues(request.query, request.body);

    if (requestIssues.length > 0) {
      return reply.code(400).send(
        validationError("Invalid run stop request.", requestIssues),
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
