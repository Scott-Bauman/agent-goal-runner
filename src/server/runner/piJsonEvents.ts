import type { RunEventPayload, RunSummaryDetails } from "../sse/types.js";

export type ParsedPiJsonEvent = {
  events: RunEventPayload[];
  metadata: Partial<
    Pick<RunSummaryDetails, "changedFiles" | "model" | "stopReason" | "tokenCount">
  >;
};

type JsonObject = Record<string, unknown>;

type ParsedLine = {
  events: RunEventPayload[];
  metadata: ParsedPiJsonEvent["metadata"];
};

type PiToolState = {
  command: string | undefined;
  files: string[];
  toolName: string;
};

const REPO_RELATIVE_PATH_PATTERN =
  /(?:^|[\s"'`(])((?:\.{1,2}[\\/])?(?:(?:src|tests|scripts|docs|\.agents)[\\/])(?:[^\s"'`()]+[\\/])*[^\s"'`()]+\.[A-Za-z0-9]+)/g;
const WINDOWS_PATH_PATTERN =
  /[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\s\r\n]+/g;

export class PiJsonEventParser {
  private buffer = "";
  private emittedFinalAssistantMessage: string | null = null;
  private finalAssistantMessage: string | null = null;
  private readonly completedToolIds = new Set<string>();
  private readonly emittedFileUpdateKeys = new Set<string>();
  private readonly startedToolIds = new Set<string>();
  private readonly toolsById = new Map<string, PiToolState>();

  push(chunk: Buffer | string): ParsedPiJsonEvent {
    this.buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? "";

    return this.parseLines(lines, false);
  }

  flush(): ParsedPiJsonEvent {
    const lines: string[] = [];

    if (this.buffer.trim().length > 0) {
      lines.push(this.buffer);
    }

    this.buffer = "";
    return this.parseLines(lines, true);
  }

  getFinalAssistantMessage(): string | null {
    return this.finalAssistantMessage;
  }

  private parseLines(
    lines: string[],
    emitPendingFinalAssistantMessage: boolean,
  ): ParsedPiJsonEvent {
    const events: RunEventPayload[] = [];
    const metadata: ParsedPiJsonEvent["metadata"] = {};

    for (const line of lines) {
      const parsedLine = this.parseLine(line);

      if (!parsedLine) {
        continue;
      }

      events.push(...parsedLine.events);
      mergeMetadata(metadata, parsedLine.metadata);
      mergeEventFileMetadata(metadata, parsedLine.events);
    }

    if (emitPendingFinalAssistantMessage) {
      const finalAssistantEvent = this.createFinalAssistantEvent(
        this.finalAssistantMessage,
      );

      if (finalAssistantEvent) {
        events.push(finalAssistantEvent);
      }
    }

    return {
      events,
      metadata,
    };
  }

  private parseLine(line: string): ParsedLine | null {
    const trimmedLine = line.trim();

    if (trimmedLine.length === 0) {
      return null;
    }

    let object: JsonObject;

    try {
      const parsed = JSON.parse(trimmedLine) as unknown;

      if (!isJsonObject(parsed)) {
        return null;
      }

      object = parsed;
    } catch {
      return null;
    }

    return {
      events: this.toRunEvents(object),
      metadata: extractMetadata(object),
    };
  }

  private toRunEvents(object: JsonObject): RunEventPayload[] {
    const type = normalizeText(getStringField(object, "type"));

    switch (type) {
      case "session":
        return this.createSessionEvents(object);
      case "agent_start":
        return [
          {
            kind: "agent_session_started",
            message: "Pi agent started.",
          },
        ];
      case "turn_start":
        return [
          {
            kind: "agent_session_started",
            message: "Pi turn started.",
          },
        ];
      case "message_start":
        return this.createMessageStartEvents(object);
      case "message_update":
        return this.createMessageUpdateEvents(object);
      case "message_end":
        return this.createMessageEndEvents(object);
      case "turn_end":
        return this.createTurnEndEvents(object);
      case "agent_end":
        return this.createAgentEndEvents(object);
      case "tool_execution_start":
        return this.createToolStartEvents(object);
      case "tool_execution_update":
        return this.createToolUpdateEvents(object);
      case "tool_execution_end":
        return this.createToolEndEvents(object);
      case "compaction_start":
        return this.createCompactionStartEvents(object);
      case "compaction_end":
        return this.createCompactionEndEvents(object);
      case "auto_retry_start":
        return this.createAutoRetryStartEvents(object);
      case "auto_retry_end":
        return this.createAutoRetryEndEvents(object);
      default:
        return [];
    }
  }

  private createSessionEvents(object: JsonObject): RunEventPayload[] {
    const sessionId = getStringField(object, "id", "session_id", "sessionId");

    return [
      {
        kind: "agent_session_started",
        message: sessionId
          ? `Pi session started: ${sessionId}`
          : "Pi session started.",
      },
    ];
  }

  private createMessageStartEvents(object: JsonObject): RunEventPayload[] {
    const message = getObjectField(object, "message");
    const assistantText = message ? extractAssistantText(message) : "";

    if (assistantText) {
      this.finalAssistantMessage = assistantText;
    }

    return [];
  }

  private createMessageUpdateEvents(object: JsonObject): RunEventPayload[] {
    const event = getObjectField(object, "assistantMessageEvent");
    const delta = event ? getRawStringField(event, "delta", "text") : undefined;
    const message = getObjectField(object, "message");
    const assistantText = message ? extractAssistantText(message) : "";

    if (delta) {
      this.finalAssistantMessage = `${this.finalAssistantMessage ?? ""}${delta}`;
    } else if (assistantText) {
      this.finalAssistantMessage = assistantText;
    }

    return [];
  }

  private createMessageEndEvents(object: JsonObject): RunEventPayload[] {
    const message = getObjectField(object, "message");
    const finalAssistantEvent = this.createFinalAssistantEvent(
      message ? extractAssistantText(message) : this.finalAssistantMessage,
    );

    return finalAssistantEvent ? [finalAssistantEvent] : [];
  }

  private createTurnEndEvents(object: JsonObject): RunEventPayload[] {
    const events: RunEventPayload[] = [];
    const message = getObjectField(object, "message");
    const finalAssistantEvent = this.createFinalAssistantEvent(
      message ? extractAssistantText(message) : this.finalAssistantMessage,
    );

    if (finalAssistantEvent) {
      events.push(finalAssistantEvent);
    }

    for (const toolResult of getObjectArrayField(object, "toolResults", "tool_results")) {
      events.push(...this.createToolResultEvents(toolResult));
    }

    return events;
  }

  private createAgentEndEvents(object: JsonObject): RunEventPayload[] {
    const messages = getObjectArrayField(object, "messages");
    const lastAssistantText = messages
      .map((message) => extractAssistantText(message))
      .filter((message) => message.length > 0)
      .at(-1);
    const finalAssistantEvent = this.createFinalAssistantEvent(
      lastAssistantText ?? this.finalAssistantMessage,
    );

    return finalAssistantEvent ? [finalAssistantEvent] : [];
  }

  private createToolStartEvents(object: JsonObject): RunEventPayload[] {
    const toolId = getStringField(object, "toolCallId", "tool_call_id", "id");
    const toolName = getStringField(object, "toolName", "tool_name", "name") ?? "";
    const args = getObjectField(object, "args") ?? {};
    const command = extractCommand(args) ?? extractCommand(object);
    const files = extractChangedFilesFromObject(args);

    return this.ensureToolStarted(toolId, toolName, command, files);
  }

  private createToolUpdateEvents(object: JsonObject): RunEventPayload[] {
    const toolId = getStringField(object, "toolCallId", "tool_call_id", "id");
    const toolName = getStringField(object, "toolName", "tool_name", "name") ?? "";
    const args = getObjectField(object, "args") ?? {};
    const partialResult = getJsonObjectFromField(
      object,
      "partialResult",
      "partial_result",
    );
    const toolState = toolId ? this.toolsById.get(toolId) : undefined;
    const command = toolState?.command ?? extractCommand(args) ?? extractCommand(object);
    const files = [
      ...new Set([
        ...(toolState?.files ?? []),
        ...extractChangedFilesFromObject(args),
        ...extractChangedFilesFromObject(partialResult ?? {}),
      ]),
    ].sort((first, second) => first.localeCompare(second));
    const events = this.ensureToolStarted(
      toolId,
      toolState?.toolName ?? toolName,
      command,
      files,
    );
    const resultText = partialResult ? extractToolResultText(partialResult) : "";

    if (resultText && isErrorLike(partialResult ?? {})) {
      events.push({
        kind: "warning",
        message: withResultText(
          formatToolMessage(createToolLabel(toolState?.toolName ?? toolName, files), "update warning"),
          resultText,
        ),
        toolName: (toolState?.toolName ?? toolName) || undefined,
      });
    }

    if (isFileEditTool(toolState?.toolName ?? toolName) && files.length > 0) {
      const key = files.join("\n");

      if (!this.emittedFileUpdateKeys.has(key)) {
        this.emittedFileUpdateKeys.add(key);
        events.push({
          files,
          kind: "file_changed",
          message: formatFilesMessage(files, "File changed."),
        });
      }
    }

    return events;
  }

  private createToolEndEvents(object: JsonObject): RunEventPayload[] {
    return this.createToolResultEvents(object);
  }

  private createToolResultEvents(toolResult: JsonObject): RunEventPayload[] {
    const toolId = getStringField(toolResult, "toolCallId", "tool_call_id", "id");
    const result = getJsonObjectFromField(toolResult, "result") ?? {};
    const toolState = toolId ? this.toolsById.get(toolId) : undefined;
    const toolName =
      toolState?.toolName ??
      getStringField(toolResult, "toolName", "tool_name", "name") ??
      "";
    const args = getObjectField(toolResult, "args") ?? {};
    const command =
      toolState?.command ??
      extractCommand(args) ??
      extractCommand(result) ??
      extractCommand(toolResult);
    const files = [
      ...new Set([
        ...(toolState?.files ?? []),
        ...extractChangedFilesFromObject(args),
        ...extractChangedFilesFromObject(result),
        ...extractChangedFilesFromObject(toolResult),
      ]),
    ].sort((first, second) => first.localeCompare(second));
    const isError =
      toolResult["isError"] === true ||
      toolResult["is_error"] === true ||
      isErrorLike(result);
    const resultText = extractToolResultText(result || toolResult);
    const events = this.ensureToolStarted(toolId, toolName, command, files);

    if (toolId) {
      if (this.completedToolIds.has(toolId)) {
        return events;
      }

      this.completedToolIds.add(toolId);
    }

    if (isCommandTool(toolName, command)) {
      events.push({
        command,
        kind: isError ? "command_failed" : "command_succeeded",
        message: withResultText(
          formatCommandMessage(command, isError ? "failed" : "succeeded"),
          isError ? resultText : "",
        ),
      });
    } else {
      events.push({
        kind: isError ? "tool_failed" : "tool_succeeded",
        message: withResultText(
          formatToolMessage(
            createToolLabel(toolName, files),
            isError ? "failed" : "succeeded",
          ),
          isError ? resultText : "",
        ),
        toolName: toolName || undefined,
      });
    }

    if (!isError && isFileEditTool(toolName) && files.length > 0) {
      events.push({
        files,
        kind: "patch_applied",
        message: formatFilesMessage(files, "Patch applied."),
      });
    }

    return events;
  }

  private createCompactionStartEvents(object: JsonObject): RunEventPayload[] {
    const reason = getStringField(object, "reason");

    return [
      {
        kind: "warning",
        message: reason
          ? `Pi compaction started: ${reason}.`
          : "Pi compaction started.",
      },
    ];
  }

  private createCompactionEndEvents(object: JsonObject): RunEventPayload[] {
    const reason = getStringField(object, "reason");
    const errorMessage = getStringField(object, "errorMessage", "error_message");
    const aborted = object["aborted"] === true;
    const willRetry = object["willRetry"] === true || object["will_retry"] === true;
    const status = aborted ? "aborted" : "finished";
    const retrySuffix = willRetry ? " Will retry." : "";
    const reasonSuffix = reason ? `: ${reason}` : "";
    const errorSuffix = errorMessage ? `\n${errorMessage}` : "";

    return [
      {
        kind: errorMessage || aborted ? "error" : "warning",
        message: `Pi compaction ${status}${reasonSuffix}.${retrySuffix}${errorSuffix}`,
        stopReason: errorMessage || aborted ? errorMessage || "Pi compaction aborted." : undefined,
      },
    ];
  }

  private createAutoRetryStartEvents(object: JsonObject): RunEventPayload[] {
    const attempt = getNumberField(object, "attempt");
    const maxAttempts = getNumberField(object, "maxAttempts", "max_attempts");
    const errorMessage = getStringField(object, "errorMessage", "error_message");
    const attemptLabel =
      typeof attempt === "number" && typeof maxAttempts === "number"
        ? ` ${attempt}/${maxAttempts}`
        : "";

    return [
      {
        kind: "warning",
        message: errorMessage
          ? `Pi retry${attemptLabel} scheduled: ${errorMessage}`
          : `Pi retry${attemptLabel} scheduled.`,
      },
    ];
  }

  private createAutoRetryEndEvents(object: JsonObject): RunEventPayload[] {
    const success = object["success"] === true;
    const attempt = getNumberField(object, "attempt");
    const finalError = getStringField(object, "finalError", "final_error");
    const attemptLabel = typeof attempt === "number" ? ` ${attempt}` : "";

    if (success) {
      return [
        {
          kind: "warning",
          message: `Pi retry${attemptLabel} succeeded.`,
        },
      ];
    }

    return [
      {
        kind: "error",
        message: finalError
          ? `Pi retry${attemptLabel} failed: ${finalError}`
          : `Pi retry${attemptLabel} failed.`,
        stopReason: finalError || "Pi retry failed.",
      },
    ];
  }

  private ensureToolStarted(
    toolId: string | undefined,
    toolName: string,
    command: string | undefined,
    files: string[],
  ): RunEventPayload[] {
    if (toolId) {
      const existingState = this.toolsById.get(toolId);

      this.toolsById.set(toolId, {
        command: existingState?.command ?? command,
        files: [
          ...new Set([...(existingState?.files ?? []), ...files]),
        ].sort((first, second) => first.localeCompare(second)),
        toolName: existingState?.toolName ?? toolName,
      });

      if (this.startedToolIds.has(toolId)) {
        return [];
      }

      this.startedToolIds.add(toolId);
    }

    if (isCommandTool(toolName, command)) {
      return [
        {
          command,
          kind: "command_started",
          message: formatCommandMessage(command, "started"),
        },
      ];
    }

    return [
      {
        kind: "tool_started",
        message: formatToolMessage(createToolLabel(toolName, files), "started"),
        toolName: toolName || undefined,
      },
    ];
  }

  private createFinalAssistantEvent(
    message: string | null | undefined,
  ): RunEventPayload | null {
    const finalAssistantMessage = message?.trim();

    if (!finalAssistantMessage) {
      return null;
    }

    this.finalAssistantMessage = finalAssistantMessage;

    if (this.emittedFinalAssistantMessage === finalAssistantMessage) {
      return null;
    }

    this.emittedFinalAssistantMessage = finalAssistantMessage;

    return {
      kind: "final_assistant_message",
      message: finalAssistantMessage,
    };
  }
}

function mergeMetadata(
  target: ParsedPiJsonEvent["metadata"],
  source: ParsedPiJsonEvent["metadata"],
): void {
  if (source.model) {
    target.model = source.model;
  }

  if (source.stopReason) {
    target.stopReason = source.stopReason;
  }

  if (typeof source.tokenCount === "number") {
    target.tokenCount = source.tokenCount;
  }

  if (source.changedFiles) {
    target.changedFiles = [
      ...new Set([...(target.changedFiles ?? []), ...source.changedFiles]),
    ].sort((first, second) => first.localeCompare(second));
  }
}

function mergeEventFileMetadata(
  target: ParsedPiJsonEvent["metadata"],
  events: RunEventPayload[],
): void {
  const changedFiles = events.flatMap((event) => event.files ?? []);

  if (changedFiles.length === 0) {
    return;
  }

  target.changedFiles = [
    ...new Set([...(target.changedFiles ?? []), ...changedFiles]),
  ].sort((first, second) => first.localeCompare(second));
}

function extractMetadata(object: JsonObject): ParsedPiJsonEvent["metadata"] {
  const metadata: ParsedPiJsonEvent["metadata"] = {};
  const message = getObjectField(object, "message");
  const usage =
    getObjectField(object, "usage", "tokenUsage", "token_usage") ??
    (message ? getObjectField(message, "usage", "tokenUsage", "token_usage") : undefined);
  const model =
    getStringField(object, "model") ??
    (message ? getStringField(message, "model") : undefined);
  const stopReason =
    getStringField(object, "stopReason", "stop_reason", "finishReason", "finish_reason") ??
    (message
      ? getStringField(message, "stopReason", "stop_reason", "finishReason", "finish_reason")
      : undefined);
  const tokenCount = usage ? getUsageTokenCount(usage) : undefined;
  const changedFiles = extractChangedFilesFromObject(object);

  if (model) {
    metadata.model = model;
  }

  if (stopReason) {
    metadata.stopReason = stopReason;
  }

  if (typeof tokenCount === "number") {
    metadata.tokenCount = tokenCount;
  }

  if (changedFiles.length > 0) {
    metadata.changedFiles = changedFiles;
  }

  return metadata;
}

function extractAssistantText(object: JsonObject): string {
  const role = normalizeText(getStringField(object, "role"));

  if (role && role !== "assistant") {
    return "";
  }

  const directText = getStringField(object, "text", "result", "summary");

  if (directText) {
    return directText;
  }

  const content = object["content"];

  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }

      return isJsonObject(item)
        ? getStringField(item, "text", "content", "delta")
        : undefined;
    })
    .filter((text): text is string => Boolean(text))
    .join("")
    .trim();
}

function extractToolResultText(result: JsonObject): string {
  const directText = getStringField(
    result,
    "errorMessage",
    "error_message",
    "error",
    "stderr",
    "message",
    "text",
    "content",
    "summary",
  );

  if (directText) {
    return directText;
  }

  const outputText = getStringField(result, "stdout", "output");

  if (outputText) {
    return outputText;
  }

  const value = result["value"];

  if (typeof value === "string") {
    return value.trim();
  }

  return "";
}

function extractCommand(object: JsonObject): string | undefined {
  return getStringField(object, "command", "cmd", "shell_command", "shellCommand");
}

function isCommandTool(toolName: string, command: string | undefined): boolean {
  const normalizedToolName = normalizeText(toolName);

  return (
    Boolean(command) ||
    normalizedToolName === "bash" ||
    normalizedToolName === "shell" ||
    normalizedToolName === "terminal"
  );
}

function isFileEditTool(toolName: string): boolean {
  const normalizedToolName = normalizeText(toolName);

  return (
    normalizedToolName === "edit" ||
    normalizedToolName === "multiedit" ||
    normalizedToolName === "notebookedit" ||
    normalizedToolName === "write" ||
    normalizedToolName === "fs_write" ||
    normalizedToolName === "apply_patch"
  );
}

function isErrorLike(object: JsonObject): boolean {
  return (
    object["isError"] === true ||
    object["is_error"] === true ||
    object["error"] !== undefined ||
    object["errorMessage"] !== undefined ||
    object["error_message"] !== undefined
  );
}

function createToolLabel(toolName: string, files: string[]): string {
  if (toolName && files.length > 0) {
    return `${toolName} (${files.join(", ")})`;
  }

  return toolName;
}

function withResultText(message: string, resultText: string): string {
  return resultText ? `${message}\n${resultText}` : message;
}

function formatCommandMessage(command: string | undefined, state: string): string {
  return command ? `Command ${state}: ${command}` : `Command ${state}.`;
}

function formatFilesMessage(files: string[], fallback: string): string {
  return files.length > 0 ? `${fallback} ${files.join(", ")}` : fallback;
}

function formatToolMessage(toolName: string, state: string): string {
  return toolName ? `Tool ${state}: ${toolName}` : `Tool ${state}.`;
}

function extractChangedFilesFromObject(object: JsonObject): string[] {
  const files = new Set<string>();

  collectPathFields(files, object);
  collectPathArrayFields(files, object);
  collectChangeArrayFields(files, object);

  for (const value of Object.values(object)) {
    if (isJsonObject(value)) {
      for (const filePath of extractChangedFilesFromObject(value)) {
        files.add(filePath);
      }
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") {
          addPath(files, item);
        } else if (isJsonObject(item)) {
          for (const filePath of extractChangedFilesFromObject(item)) {
            files.add(filePath);
          }
        }
      }
    }
  }

  for (const filePath of extractPathsFromText(extractToolResultText(object))) {
    files.add(filePath);
  }

  return Array.from(files).sort((first, second) => first.localeCompare(second));
}

function collectPathFields(files: Set<string>, object: JsonObject): void {
  for (const key of [
    "file",
    "path",
    "filename",
    "file_path",
    "filePath",
    "target_file",
    "targetFile",
  ]) {
    addPath(files, object[key]);
  }
}

function collectPathArrayFields(files: Set<string>, object: JsonObject): void {
  for (const key of ["files", "paths", "changed_files", "changedFiles"]) {
    const value = object[key];

    if (Array.isArray(value)) {
      for (const item of value) {
        addPath(files, item);
      }
    }
  }
}

function collectChangeArrayFields(files: Set<string>, object: JsonObject): void {
  const changes = object["changes"];

  if (!Array.isArray(changes)) {
    return;
  }

  for (const change of changes) {
    if (isJsonObject(change)) {
      addPath(files, change["path"]);
    }
  }
}

function addPath(files: Set<string>, value: unknown): void {
  if (typeof value === "string" && looksLikePath(value)) {
    files.add(shortenPath(value));
  }
}

function extractPathsFromText(text: string): string[] {
  const paths = new Set<string>();

  for (const match of text.matchAll(WINDOWS_PATH_PATTERN)) {
    paths.add(shortenPath(match[0]));
  }

  for (const match of text.matchAll(REPO_RELATIVE_PATH_PATTERN)) {
    paths.add(shortenPath(match[1]));
  }

  return Array.from(paths);
}

function getUsageTokenCount(usage: JsonObject): number | undefined {
  const totalTokens = getNumberField(usage, "total_tokens", "totalTokens");

  if (typeof totalTokens === "number") {
    return totalTokens;
  }

  const inputTokens = getNumberField(usage, "input_tokens", "inputTokens");
  const outputTokens = getNumberField(usage, "output_tokens", "outputTokens");

  if (typeof inputTokens !== "number" || typeof outputTokens !== "number") {
    return undefined;
  }

  return inputTokens + outputTokens;
}

function looksLikePath(value: string): boolean {
  return /[\\/]/.test(value) || /\.[A-Za-z0-9]+$/.test(value);
}

function shortenPath(value: string): string {
  const normalizedPath = value.replaceAll("\\", "/");
  const repositoryIndex = normalizedPath
    .toLowerCase()
    .lastIndexOf("/agent-goal-runner/");

  if (repositoryIndex >= 0) {
    return normalizedPath.slice(repositoryIndex + "/agent-goal-runner/".length);
  }

  for (const marker of ["/src/", "/tests/", "/scripts/", "/docs/", "/.agents/"]) {
    const markerIndex = normalizedPath.indexOf(marker);

    if (markerIndex >= 0) {
      return normalizedPath.slice(markerIndex + 1);
    }
  }

  return normalizedPath.replace(/^\.\//, "");
}

function normalizeText(value: string | undefined): string {
  return (value ?? "").toLowerCase().replaceAll(".", "_").replaceAll("-", "_");
}

function getObjectArrayField(object: JsonObject, ...keys: string[]): JsonObject[] {
  for (const key of keys) {
    const value = object[key];

    if (Array.isArray(value)) {
      return value.filter(isJsonObject);
    }
  }

  return [];
}

function getStringField(
  object: JsonObject,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = object[key];

    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

function getRawStringField(
  object: JsonObject,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = object[key];

    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return undefined;
}

function getNumberField(
  object: JsonObject,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = object[key];

    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return undefined;
}

function getObjectField(
  object: JsonObject,
  ...keys: string[]
): JsonObject | undefined {
  for (const key of keys) {
    const value = object[key];

    if (isJsonObject(value)) {
      return value;
    }
  }

  return undefined;
}

function getJsonObjectFromField(
  object: JsonObject,
  ...keys: string[]
): JsonObject | undefined {
  for (const key of keys) {
    const value = object[key];

    if (isJsonObject(value)) {
      return value;
    }

    if (typeof value === "string" && value.trim().length > 0) {
      return {
        value,
      };
    }
  }

  return undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
