import type { RunEventPayload, RunSummaryDetails } from "../sse/types.js";

export type ParsedClaudeJsonEvent = {
  events: RunEventPayload[];
  metadata: Partial<
    Pick<RunSummaryDetails, "changedFiles" | "model" | "stopReason" | "tokenCount">
  >;
};

type JsonObject = Record<string, unknown>;

type ClaudeToolState = {
  command: string | undefined;
  files: string[];
  toolName: string;
};

type ParsedLine = {
  events: RunEventPayload[];
  metadata: ParsedClaudeJsonEvent["metadata"];
};

const REPO_RELATIVE_PATH_PATTERN =
  /(?:^|[\s"'`(])((?:\.{1,2}[\\/])?(?:(?:src|tests|scripts|docs|\.agents)[\\/])(?:[^\s"'`()]+[\\/])*[^\s"'`()]+\.[A-Za-z0-9]+)/g;
const WINDOWS_PATH_PATTERN =
  /[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\s\r\n]+/g;

export class ClaudeJsonEventParser {
  private buffer = "";
  private emittedFinalAssistantMessage: string | null = null;
  private finalAssistantMessage: string | null = null;
  private readonly completedToolIds = new Set<string>();
  private readonly startedToolIds = new Set<string>();
  private readonly textBlocksByIndex = new Map<string, string>();
  private readonly toolsById = new Map<string, ClaudeToolState>();

  push(chunk: Buffer | string): ParsedClaudeJsonEvent {
    this.buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? "";

    return this.parseLines(lines, false);
  }

  flush(): ParsedClaudeJsonEvent {
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
  ): ParsedClaudeJsonEvent {
    const events: RunEventPayload[] = [];
    const metadata: ParsedClaudeJsonEvent["metadata"] = {};

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

    const metadata = extractMetadata(object);
    const events = this.toRunEvents(object);

    return {
      events,
      metadata,
    };
  }

  private toRunEvents(object: JsonObject): RunEventPayload[] {
    const type = normalizeText(getStringField(object, "type"));

    if (type === "system") {
      return this.createSystemEvents(object);
    }

    if (type === "stream_event") {
      const event = getObjectField(object, "event");

      return event ? this.createStreamEventEvents(event) : [];
    }

    if (type === "assistant") {
      return this.createAssistantEvents(object);
    }

    if (type === "user") {
      return this.createUserEvents(object);
    }

    if (type === "result") {
      return this.createResultEvents(object);
    }

    if (type === "error") {
      const message = extractMessage(object);

      return [
        {
          kind: "error",
          message: message || "Claude emitted an error.",
          stopReason: message || "Claude emitted an error.",
        },
      ];
    }

    return [];
  }

  private createSystemEvents(object: JsonObject): RunEventPayload[] {
    const subtype = normalizeText(getStringField(object, "subtype"));

    if (subtype === "init") {
      const sessionId = getStringField(object, "session_id", "sessionId");

      return [
        {
          kind: "agent_session_started",
          message: sessionId
            ? `Claude session started: ${sessionId}`
            : "Claude session started.",
        },
      ];
    }

    if (subtype === "api_retry") {
      const message = extractMessage(object);

      return [
        {
          kind: "warning",
          message: message
            ? `Claude API retry: ${message}`
            : "Claude API retry scheduled.",
        },
      ];
    }

    return [];
  }

  private createStreamEventEvents(event: JsonObject): RunEventPayload[] {
    const eventType = normalizeText(getStringField(event, "type"));

    if (eventType === "content_block_start") {
      const contentBlock = getObjectField(event, "content_block", "contentBlock");

      if (!contentBlock) {
        return [];
      }

      const contentBlockType = normalizeText(getStringField(contentBlock, "type"));

      if (contentBlockType === "text") {
        this.updateTextBlock(event, extractAssistantText(contentBlock), false);
        return [];
      }

      return this.createToolStartEvents(contentBlock);
    }

    if (eventType === "content_block_delta") {
      const delta = getObjectField(event, "delta");
      const text = delta ? getRawStringField(delta, "text") : undefined;

      if (text) {
        this.updateTextBlock(event, text, true);
      }

      return [];
    }

    if (eventType === "message_start") {
      const message = getObjectField(event, "message");

      if (message) {
        const text = extractAssistantText(message);

        if (text) {
          this.finalAssistantMessage = text;
        }
      }
    }

    if (eventType === "message_delta") {
      const delta = getObjectField(event, "delta");
      const text = delta ? extractAssistantText(delta) : "";

      if (text) {
        this.finalAssistantMessage = text;
      }
    }

    return [];
  }

  private updateTextBlock(
    event: JsonObject,
    text: string | undefined,
    append: boolean,
  ): void {
    if (!text) {
      return;
    }

    const index = getNumberField(event, "index");
    const key = typeof index === "number" ? String(index) : "0";
    const previousText = append ? this.textBlocksByIndex.get(key) ?? "" : "";

    this.textBlocksByIndex.set(key, `${previousText}${text}`);
    this.finalAssistantMessage = Array.from(this.textBlocksByIndex.entries())
      .sort(
        ([firstIndex], [secondIndex]) =>
          Number(firstIndex) - Number(secondIndex),
      )
      .map(([, blockText]) => blockText)
      .join("")
      .trim();
  }

  private createAssistantEvents(object: JsonObject): RunEventPayload[] {
    const message = getObjectField(object, "message") ?? object;
    const events: RunEventPayload[] = [];
    const assistantText = extractAssistantText(message);

    if (assistantText) {
      this.finalAssistantMessage = assistantText;
    }

    for (const contentItem of getContentItems(message)) {
      if (!isJsonObject(contentItem)) {
        continue;
      }

      const contentType = normalizeText(getStringField(contentItem, "type"));

      if (contentType === "tool_use") {
        events.push(...this.createToolStartEvents(contentItem));
      }
    }

    return events;
  }

  private createUserEvents(object: JsonObject): RunEventPayload[] {
    const message = getObjectField(object, "message") ?? object;
    const events: RunEventPayload[] = [];

    for (const contentItem of getContentItems(message)) {
      if (!isJsonObject(contentItem)) {
        continue;
      }

      const contentType = normalizeText(getStringField(contentItem, "type"));

      if (contentType === "tool_result") {
        events.push(...this.createToolResultEvents(contentItem));
      }
    }

    return events;
  }

  private createResultEvents(object: JsonObject): RunEventPayload[] {
    const events: RunEventPayload[] = [];
    const isError = object["is_error"] === true || object["isError"] === true;
    const message = extractResultMessage(object);

    if (isError) {
      const errorMessage = message || extractMessage(object) || "Claude run failed.";

      events.push({
        kind: "error",
        message: errorMessage,
        stopReason: errorMessage,
      });
      return events;
    }

    const finalAssistantEvent = this.createFinalAssistantEvent(
      message || this.finalAssistantMessage,
    );

    if (finalAssistantEvent) {
      events.push(finalAssistantEvent);
    }

    return events;
  }

  private createToolStartEvents(toolUse: JsonObject): RunEventPayload[] {
    const toolId = getStringField(toolUse, "id", "tool_use_id", "toolUseId");
    const toolName = getStringField(toolUse, "name", "tool_name", "toolName") ?? "";
    const input = getObjectField(toolUse, "input", "args") ?? {};
    const command = extractCommand(input);
    const files = extractChangedFilesFromObject(input);

    if (toolId) {
      this.toolsById.set(toolId, {
        command,
        files,
        toolName,
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

  private createToolResultEvents(toolResult: JsonObject): RunEventPayload[] {
    const toolId = getStringField(toolResult, "tool_use_id", "toolUseId", "id");
    const isError = toolResult["is_error"] === true || toolResult["isError"] === true;
    const resultText = extractToolResultText(toolResult);
    const toolState = toolId ? this.toolsById.get(toolId) : undefined;
    const toolName =
      toolState?.toolName ??
      getStringField(toolResult, "name", "tool_name", "toolName") ??
      "";
    const command = toolState?.command ?? extractCommand(toolResult);
    const files = [
      ...new Set([
        ...(toolState?.files ?? []),
        ...extractChangedFilesFromObject(toolResult),
      ]),
    ].sort((first, second) => first.localeCompare(second));

    if (toolId) {
      if (this.completedToolIds.has(toolId)) {
        return [];
      }

      this.completedToolIds.add(toolId);
    }

    const events: RunEventPayload[] = [];

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
        message: `Patch applied. ${files.join(", ")}`,
      });
    }

    return events;
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
  target: ParsedClaudeJsonEvent["metadata"],
  source: ParsedClaudeJsonEvent["metadata"],
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
  target: ParsedClaudeJsonEvent["metadata"],
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

function extractMetadata(object: JsonObject): ParsedClaudeJsonEvent["metadata"] {
  const metadata: ParsedClaudeJsonEvent["metadata"] = {};
  const message = getObjectField(object, "message");
  const event = getObjectField(object, "event");
  const nestedMessage = event ? getObjectField(event, "message") : undefined;
  const delta = event ? getObjectField(event, "delta") : undefined;
  const usage =
    getObjectField(object, "usage") ??
    (message ? getObjectField(message, "usage") : undefined) ??
    (nestedMessage ? getObjectField(nestedMessage, "usage") : undefined) ??
    (delta ? getObjectField(delta, "usage") : undefined);
  const model =
    getStringField(object, "model") ??
    (message ? getStringField(message, "model") : undefined) ??
    (nestedMessage ? getStringField(nestedMessage, "model") : undefined);
  const stopReason =
    getStringField(object, "stop_reason", "stopReason") ??
    (message ? getStringField(message, "stop_reason", "stopReason") : undefined) ??
    (delta ? getStringField(delta, "stop_reason", "stopReason") : undefined);
  const tokenCount = usage ? getUsageTokenCount(usage) : undefined;

  if (model) {
    metadata.model = model;
  }

  if (stopReason) {
    metadata.stopReason = stopReason;
  }

  if (typeof tokenCount === "number") {
    metadata.tokenCount = tokenCount;
  }

  return metadata;
}

function extractResultMessage(object: JsonObject): string {
  return getStringField(object, "result", "message", "text", "error") ?? "";
}

function extractMessage(object: JsonObject): string {
  const directMessage = getStringField(
    object,
    "message",
    "text",
    "content",
    "summary",
    "error",
  );

  if (directMessage) {
    return directMessage;
  }

  const error = getObjectField(object, "error");

  if (error) {
    return extractMessage(error);
  }

  return "";
}

function extractAssistantText(object: JsonObject): string {
  const directText = getStringField(object, "text", "result");

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
    .map((item) => (isJsonObject(item) ? getStringField(item, "text") : undefined))
    .filter((text): text is string => Boolean(text))
    .join("")
    .trim();
}

function getContentItems(object: JsonObject): unknown[] {
  const content = object["content"];

  return Array.isArray(content) ? content : [];
}

function extractToolResultText(toolResult: JsonObject): string {
  const content = toolResult["content"];

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        return isJsonObject(item) ? getStringField(item, "text", "content") : undefined;
      })
      .filter((text): text is string => Boolean(text))
      .join("\n")
      .trim();
  }

  return extractMessage(toolResult).trim();
}

function extractCommand(object: JsonObject): string | undefined {
  return getStringField(object, "command", "cmd", "shell_command", "shellCommand");
}

function isCommandTool(toolName: string, command: string | undefined): boolean {
  const normalizedToolName = normalizeText(toolName);

  return Boolean(command) || normalizedToolName === "bash" || normalizedToolName === "shell";
}

function isFileEditTool(toolName: string): boolean {
  const normalizedToolName = normalizeText(toolName);

  return (
    normalizedToolName === "edit" ||
    normalizedToolName === "multiedit" ||
    normalizedToolName === "notebookedit" ||
    normalizedToolName === "write"
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

function formatToolMessage(toolName: string, state: string): string {
  return toolName ? `Tool ${state}: ${toolName}` : `Tool ${state}.`;
}

function extractChangedFilesFromObject(object: JsonObject): string[] {
  const files = new Set<string>();

  collectPathFields(files, object);
  collectPathArrayFields(files, object);

  for (const value of Object.values(object)) {
    if (isJsonObject(value)) {
      for (const filePath of extractChangedFilesFromObject(value)) {
        files.add(filePath);
      }
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (!isJsonObject(item)) {
          continue;
        }

        for (const filePath of extractChangedFilesFromObject(item)) {
          files.add(filePath);
        }
      }
    }
  }

  for (const filePath of extractPathsFromText(extractMessage(object))) {
    files.add(filePath);
  }

  return Array.from(files).sort((first, second) => first.localeCompare(second));
}

function collectPathFields(files: Set<string>, object: JsonObject): void {
  for (const key of ["file", "path", "filename", "file_path", "filePath"]) {
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

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
