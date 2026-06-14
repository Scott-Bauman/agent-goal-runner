import type {
  RunEventPayload,
  RunSummaryDetails,
  SkillPreflightStatus,
} from "../sse/types.js";
import {
  getSkillInstallStatus,
  type SkillPathOptions,
} from "../skills/skillInstallation.js";

export type ParsedCodexJsonEvent = {
  events: RunEventPayload[];
  metadata: Partial<
    Pick<
      RunSummaryDetails,
      "changedFiles" | "model" | "reasoningEffort" | "stopReason" | "tokenCount"
    >
  >;
};

type JsonObject = Record<string, unknown>;

type RunEventParseContext = {
  command: string | undefined;
  exitCode: number | undefined;
  files: string[];
  level: string;
  message: string;
  normalizedType: string;
  role: string;
  status: string;
};

const SKILL_REFERENCE_PATTERN = /\$([A-Za-z0-9][A-Za-z0-9_-]*)\b/g;
const DIRECT_SKILL_REFERENCE_PATTERN =
  /\b(?:use|invoke|load|apply)\s+(?:the\s+)?(?:skill\s+)?([A-Za-z0-9][A-Za-z0-9_-]*)\s+skill\b/gi;
const REPO_RELATIVE_PATH_PATTERN =
  /(?:^|[\s"'`(])((?:\.{1,2}[\\/])?(?:(?:src|tests|scripts|docs|\.agents)[\\/])(?:[^\s"'`()]+[\\/])*[^\s"'`()]+\.[A-Za-z0-9]+)/g;
const WINDOWS_PATH_PATTERN =
  /[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\s\r\n]+/g;
const DIFF_PATTERN = /(?:^|\n)(?:diff --git |\+\+\+ |--- |@@ )/;

export function preferSkillReferenceSyntax(prompt: string): string {
  return prompt.replace(
    DIRECT_SKILL_REFERENCE_PATTERN,
    (_match, skillName: string) => `Use $${skillName}`,
  );
}

export function extractReferencedSkillNames(prompt: string): string[] {
  const skillNames = new Set<string>();

  for (const match of prompt.matchAll(SKILL_REFERENCE_PATTERN)) {
    skillNames.add(match[1]);
  }

  for (const match of prompt.matchAll(DIRECT_SKILL_REFERENCE_PATTERN)) {
    skillNames.add(match[1]);
  }

  return Array.from(skillNames).sort((first, second) =>
    first.localeCompare(second),
  );
}

export function createSkillPreflightStatus(
  repositoryPath: string,
  prompt: string,
  skillExists: (skillPath: string) => boolean,
  options: Omit<SkillPathOptions, "repositoryPath" | "skillExists"> = {},
): SkillPreflightStatus {
  const skillNames = extractReferencedSkillNames(prompt);

  if (skillNames.length === 0) {
    return {
      checked: false,
      missing: [],
      found: [],
      locations: [],
    };
  }

  const found: string[] = [];
  const missing: string[] = [];
  const locations: SkillPreflightStatus["locations"] = [];

  for (const skillName of skillNames) {
    const status = getSkillInstallStatus(skillName, {
      ...options,
      repositoryPath,
      skillExists,
    });

    locations.push(status);

    if (status.installed) {
      found.push(skillName);
    } else {
      missing.push(skillName);
    }
  }

  return {
    checked: true,
    found,
    locations,
    missing,
  };
}

export class CodexJsonEventParser {
  private buffer = "";
  private readonly seenDiffs = new Set<string>();

  push(chunk: Buffer | string): ParsedCodexJsonEvent {
    this.buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? "";

    return this.parseLines(lines);
  }

  flush(): ParsedCodexJsonEvent {
    if (this.buffer.trim().length === 0) {
      this.buffer = "";
      return {
        events: [],
        metadata: {},
      };
    }

    const line = this.buffer;
    this.buffer = "";
    return this.parseLines([line]);
  }

  private parseLines(lines: string[]): ParsedCodexJsonEvent {
    const events: RunEventPayload[] = [];
    const metadata: ParsedCodexJsonEvent["metadata"] = {};

    for (const line of lines) {
      const parsedLine = parseCodexJsonLine(line, this.seenDiffs);

      if (!parsedLine) {
        continue;
      }

      events.push(...parsedLine.events);

      if (parsedLine.metadata.model) {
        metadata.model = parsedLine.metadata.model;
      }

      if (parsedLine.metadata.reasoningEffort) {
        metadata.reasoningEffort = parsedLine.metadata.reasoningEffort;
      }

      if (typeof parsedLine.metadata.tokenCount === "number") {
        metadata.tokenCount = parsedLine.metadata.tokenCount;
      }

      if (parsedLine.metadata.stopReason) {
        metadata.stopReason = parsedLine.metadata.stopReason;
      }

      if (parsedLine.metadata.changedFiles) {
        metadata.changedFiles = [
          ...new Set([...(metadata.changedFiles ?? []), ...parsedLine.metadata.changedFiles]),
        ];
      }
    }

    return {
      events,
      metadata,
    };
  }
}

function parseCodexJsonLine(
  line: string,
  seenDiffs: Set<string>,
): ParsedCodexJsonEvent | null {
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
  const event = toRunEvent(object, seenDiffs);

  return {
    events: event ? [event] : [],
    metadata,
  };
}

function toRunEvent(
  object: JsonObject,
  seenDiffs: Set<string>,
): RunEventPayload | null {
  const codexExecEvent = createCodexExecEvent(object);

  if (codexExecEvent) {
    return codexExecEvent;
  }

  const context = createRunEventParseContext(object);

  return (
    createLevelEvent(context) ??
    createSessionEvent(context) ??
    createCommandEvent(context) ??
    createPatchEvent(context, seenDiffs) ??
    createFileEvent(context) ??
    createAssistantMessageEvent(context) ??
    createFailureEvent(context) ??
    createSkillLookupWarning(context)
  );
}

function createCodexExecEvent(object: JsonObject): RunEventPayload | null {
  const normalizedType = normalizeText(getStringField(object, "type"));

  if (normalizedType === "thread_started") {
    const threadId = getStringField(object, "thread_id");

    return {
      kind: "codex_session_started",
      message: threadId
        ? `Codex thread started: ${threadId}`
        : "Codex thread started.",
    };
  }

  if (normalizedType === "turn_started") {
    return {
      kind: "agent_session_started",
      message: "Codex turn started.",
    };
  }

  if (normalizedType === "turn_failed") {
    const error = getObjectField(object, "error");
    const message = error ? extractMessage(error) : extractMessage(object);

    return {
      kind: "error",
      message: message || "Codex turn failed.",
      stopReason: message || "Codex turn failed.",
    };
  }

  if (normalizedType === "error") {
    const message = extractMessage(object);

    return {
      kind: "error",
      message: message || "Codex emitted an error.",
      stopReason: message || "Codex emitted an error.",
    };
  }

  if (
    normalizedType !== "item_started" &&
    normalizedType !== "item_completed"
  ) {
    return null;
  }

  const item = getObjectField(object, "item");

  if (!item) {
    return null;
  }

  return createCodexExecItemEvent(item, normalizedType);
}

function createCodexExecItemEvent(
  item: JsonObject,
  normalizedEventType: string,
): RunEventPayload | null {
  const itemType = normalizeText(getStringField(item, "type"));

  if (itemType === "command_execution") {
    return createCodexCommandExecutionEvent(item, normalizedEventType);
  }

  if (itemType === "file_change") {
    return createCodexFileChangeEvent(item, normalizedEventType);
  }

  if (itemType === "mcp_tool_call") {
    return createCodexMcpToolCallEvent(item, normalizedEventType);
  }

  if (itemType === "web_search") {
    return createCodexWebSearchEvent(item, normalizedEventType);
  }

  if (itemType === "agent_message" && normalizedEventType === "item_completed") {
    const message = getStringField(item, "text");

    return message
      ? {
          kind: "final_assistant_message",
          message,
        }
      : null;
  }

  if (itemType === "error" && normalizedEventType === "item_completed") {
    return {
      kind: "warning",
      message: extractMessage(item) || "Codex reported a warning.",
    };
  }

  return null;
}

function createCodexCommandExecutionEvent(
  item: JsonObject,
  normalizedEventType: string,
): RunEventPayload | null {
  const command = getStringField(item, "command");
  const exitCode = getNumberField(item, "exit_code", "exitCode");
  const status = normalizeText(getStringField(item, "status"));

  if (
    normalizedEventType === "item_completed" &&
    (status === "failed" || status === "declined" || isNonZeroExitCode(exitCode))
  ) {
    return {
      command,
      exitCode,
      kind: "command_failed",
      message: formatCommandMessage(command, "failed"),
    };
  }

  if (normalizedEventType === "item_completed" || status === "completed") {
    return {
      command,
      exitCode,
      kind: "command_succeeded",
      message: formatCommandMessage(command, "succeeded"),
    };
  }

  if (normalizedEventType !== "item_started") {
    return null;
  }

  return {
    command,
    kind: "command_started",
    message: formatCommandMessage(command, "started"),
  };
}

function createCodexFileChangeEvent(
  item: JsonObject,
  normalizedEventType: string,
): RunEventPayload | null {
  if (normalizedEventType !== "item_completed") {
    return null;
  }

  const files = extractChangedFilesFromObject(item);
  const status = normalizeText(getStringField(item, "status"));

  if (status === "failed") {
    return {
      files,
      kind: "error",
      message: formatFilesMessage(files, "Patch failed."),
      stopReason: "Patch failed.",
    };
  }

  return {
    files,
    kind: "patch_applied",
    message: formatFilesMessage(files, "Patch applied."),
  };
}

function createCodexMcpToolCallEvent(
  item: JsonObject,
  normalizedEventType: string,
): RunEventPayload | null {
  const server = getStringField(item, "server");
  const tool = getStringField(item, "tool");
  const toolName = [server, tool].filter(Boolean).join(".");
  const status = normalizeText(getStringField(item, "status"));

  if (
    normalizedEventType === "item_completed" &&
    (status === "failed" || getObjectField(item, "error"))
  ) {
    const error = getObjectField(item, "error");
    const message = error ? extractMessage(error) : "";

    return {
      kind: "tool_failed",
      message: message || formatToolMessage(toolName, "failed"),
      toolName: toolName || undefined,
    };
  }

  if (normalizedEventType === "item_completed" || status === "completed") {
    return {
      kind: "tool_succeeded",
      message: formatToolMessage(toolName, "succeeded"),
      toolName: toolName || undefined,
    };
  }

  if (normalizedEventType !== "item_started") {
    return null;
  }

  return {
    kind: "tool_started",
    message: formatToolMessage(toolName, "started"),
    toolName: toolName || undefined,
  };
}

function createCodexWebSearchEvent(
  item: JsonObject,
  normalizedEventType: string,
): RunEventPayload | null {
  const query = getStringField(item, "query");
  const toolName = "web_search";

  if (normalizedEventType === "item_completed") {
    return {
      kind: "tool_succeeded",
      message: query
        ? `Tool succeeded: web_search (${query})`
        : "Tool succeeded: web_search",
      toolName,
    };
  }

  if (normalizedEventType !== "item_started") {
    return null;
  }

  return {
    kind: "tool_started",
    message: query
      ? `Tool started: web_search (${query})`
      : "Tool started: web_search",
    toolName,
  };
}

function createRunEventParseContext(object: JsonObject): RunEventParseContext {
  const type = getStringField(object, "type", "event", "name", "kind");

  return {
    command: getStringField(object, "command", "cmd"),
    exitCode: getNumberField(object, "exit_code", "exitCode", "code"),
    files: extractChangedFilesFromObject(object),
    level: normalizeText(getStringField(object, "level", "severity")),
    message: extractMessage(object),
    normalizedType: normalizeText(type),
    role: normalizeText(getStringField(object, "role")),
    status: normalizeText(getStringField(object, "status", "state", "outcome")),
  };
}

function createLevelEvent(
  context: RunEventParseContext,
): RunEventPayload | null {
  const { level, message } = context;

  if (level === "warn" || level === "warning") {
    return {
      kind: "warning",
      message: message || "Codex emitted a warning.",
    };
  }

  if (level !== "error") {
    return null;
  }

  return {
    kind: isFailedSkillLookup(message) ? "warning" : "error",
    message: message || "Codex emitted an error.",
  };
}

function createSessionEvent(
  context: RunEventParseContext,
): RunEventPayload | null {
  const { message, normalizedType, status } = context;
  const isSessionType =
    normalizedType.includes("session") ||
    normalizedType.includes("thread") ||
    normalizedType.includes("conversation");

  if (!isSessionType || !isStarted(normalizedType, status)) {
    return null;
  }

  return {
    kind: "codex_session_started",
    message: message || "Codex session started.",
  };
}

function createCommandEvent(
  context: RunEventParseContext,
): RunEventPayload | null {
  const { command, exitCode, message, normalizedType, status } = context;

  if (!normalizedType.includes("command") && !command) {
    return null;
  }

  if (isFailed(normalizedType, status) || isNonZeroExitCode(exitCode)) {
    return {
      command,
      exitCode,
      kind: "command_failed",
      message: message || formatCommandMessage(command, "failed"),
    };
  }

  if (isSucceeded(normalizedType, status) || exitCode === 0) {
    return {
      command,
      exitCode,
      kind: "command_succeeded",
      message: message || formatCommandMessage(command, "succeeded"),
    };
  }

  if (!isStarted(normalizedType, status)) {
    return null;
  }

  return {
    command,
    kind: "command_started",
    message: message || formatCommandMessage(command, "started"),
  };
}

function createPatchEvent(
  context: RunEventParseContext,
  seenDiffs: Set<string>,
): RunEventPayload | null {
  const { files, message, normalizedType } = context;

  if (!normalizedType.includes("patch") && !hasDiff(message)) {
    return null;
  }

  if (hasSeenDiff(message, seenDiffs)) {
    return null;
  }

  return {
    files,
    kind: "patch_applied",
    message: message || formatFilesMessage(files, "Patch applied."),
  };
}

function createFileEvent(
  context: RunEventParseContext,
): RunEventPayload | null {
  const { files, message, normalizedType } = context;

  if (files.length === 0 && !normalizedType.includes("file")) {
    return null;
  }

  return {
    files,
    kind: "file_changed",
    message: message || formatFilesMessage(files, "File changed."),
  };
}

function createAssistantMessageEvent(
  context: RunEventParseContext,
): RunEventPayload | null {
  const { message, normalizedType, role } = context;

  if (
    role !== "assistant" ||
    (!normalizedType.includes("message") && !normalizedType.includes("response")) ||
    !message
  ) {
    return null;
  }

  return {
    kind: "final_assistant_message",
    message,
  };
}

function createFailureEvent(
  context: RunEventParseContext,
): RunEventPayload | null {
  const { message, normalizedType, status } = context;

  if (!isFailed(normalizedType, status)) {
    return null;
  }

  return {
    kind: isFailedSkillLookup(message) ? "warning" : "error",
    message: message || "Codex reported a failure.",
  };
}

function createSkillLookupWarning(
  context: RunEventParseContext,
): RunEventPayload | null {
  if (!context.message || !isFailedSkillLookup(context.message)) {
    return null;
  }

  return {
    kind: "warning",
    message: context.message,
  };
}

function isNonZeroExitCode(exitCode: number | undefined): boolean {
  return typeof exitCode === "number" && exitCode !== 0;
}

function hasSeenDiff(message: string, seenDiffs: Set<string>): boolean {
  const diffFingerprint = message ? normalizeDiff(message) : null;

  if (!diffFingerprint) {
    return false;
  }

  if (seenDiffs.has(diffFingerprint)) {
    return true;
  }

  seenDiffs.add(diffFingerprint);
  return false;
}

function extractMetadata(object: JsonObject): ParsedCodexJsonEvent["metadata"] {
  const usage = getObjectField(object, "usage", "token_usage");
  const metadata: ParsedCodexJsonEvent["metadata"] = {};
  const changedFiles = extractChangedFilesFromObject(object);
  const model = getStringField(object, "model");
  const reasoningEffort =
    getStringField(object, "reasoning_effort", "reasoningEffort") ??
    getConfigValue(object, "model_reasoning_effort");
  const tokenCount =
    getNumberField(object, "total_tokens", "token_count", "tokenCount") ??
    (usage
      ? getNumberField(usage, "total_tokens", "token_count", "tokenCount")
      : undefined) ??
    (usage
      ? getCodexExecUsageTokenCount(usage)
      : undefined);
  const stopReason = getStringField(object, "stop_reason", "stopReason");

  if (model) {
    metadata.model = model;
  }

  if (reasoningEffort) {
    metadata.reasoningEffort = reasoningEffort;
  }

  if (typeof tokenCount === "number") {
    metadata.tokenCount = tokenCount;
  }

  if (stopReason) {
    metadata.stopReason = stopReason;
  }

  if (changedFiles.length > 0) {
    metadata.changedFiles = changedFiles;
  }

  return metadata;
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

  const item = getObjectField(object, "item", "data", "payload");

  if (item) {
    return extractMessage(item);
  }

  return "";
}

function extractChangedFilesFromObject(object: JsonObject): string[] {
  const files = new Set<string>();

  collectPathFields(files, object);
  collectPathArrayFields(files, object);
  collectChangeArrayFields(files, object);

  for (const key of ["item", "data", "payload"]) {
    const nestedObject = getObjectField(object, key);

    if (!nestedObject) {
      continue;
    }

    for (const filePath of extractChangedFilesFromObject(nestedObject)) {
      files.add(filePath);
    }
  }

  const message = extractMessage(object);

  for (const filePath of extractPathsFromText(message)) {
    files.add(filePath);
  }

  return Array.from(files).sort((first, second) => first.localeCompare(second));
}

function collectPathFields(files: Set<string>, object: JsonObject): void {
  for (const key of ["file", "path", "filename"]) {
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
    const matchedPath = match[1];
    paths.add(shortenPath(matchedPath));
  }

  return Array.from(paths);
}

function hasDiff(text: string): boolean {
  return DIFF_PATTERN.test(text);
}

function normalizeDiff(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\s+$/g, "");
}

function isFailedSkillLookup(message: string): boolean {
  const normalizedMessage = normalizeText(message);

  return (
    normalizedMessage.includes("skill") &&
    (normalizedMessage.includes("not found") ||
      normalizedMessage.includes("missing") ||
      normalizedMessage.includes("failed")) &&
    (normalizedMessage.includes("skill.md") ||
      normalizedMessage.includes("skill_md"))
  );
}

function isStarted(type: string, status: string): boolean {
  return (
    type.endsWith("started") ||
    type.includes("start") ||
    status === "started" ||
    status === "running"
  );
}

function isSucceeded(type: string, status: string): boolean {
  return (
    type.includes("succeeded") ||
    type.includes("success") ||
    type.includes("completed") ||
    status === "succeeded" ||
    status === "success" ||
    status === "completed"
  );
}

function isFailed(type: string, status: string): boolean {
  return (
    type.includes("failed") ||
    type.includes("error") ||
    status === "failed" ||
    status === "error"
  );
}

function formatCommandMessage(command: string | undefined, state: string): string {
  return command ? `Command ${state}: ${command}` : `Command ${state}.`;
}

function formatToolMessage(toolName: string, state: string): string {
  return toolName ? `Tool ${state}: ${toolName}` : `Tool ${state}.`;
}

function formatFilesMessage(files: string[], fallback: string): string {
  return files.length > 0 ? `${fallback} ${files.join(", ")}` : fallback;
}

function getCodexExecUsageTokenCount(usage: JsonObject): number | undefined {
  const inputTokens = getNumberField(usage, "input_tokens", "inputTokens");
  const outputTokens = getNumberField(usage, "output_tokens", "outputTokens");

  if (typeof inputTokens !== "number" && typeof outputTokens !== "number") {
    return undefined;
  }

  return (inputTokens ?? 0) + (outputTokens ?? 0);
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
  return (value ?? "").toLowerCase().replaceAll(".", "_");
}

function getStringField(
  object: JsonObject,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = object[key];

    if (typeof value === "string" && value.trim().length > 0) {
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

function getConfigValue(
  object: JsonObject,
  key: string,
): string | undefined {
  const config = getObjectField(object, "config");
  const value = config?.[key];

  return typeof value === "string" ? value : undefined;
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
