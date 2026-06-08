import path from "node:path";

import type {
  RunEventPayload,
  RunSummaryDetails,
  SkillPreflightStatus,
} from "../sse/types.js";

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
): SkillPreflightStatus {
  const skillNames = extractReferencedSkillNames(prompt);

  if (skillNames.length === 0) {
    return {
      checked: false,
      missing: [],
      found: [],
    };
  }

  const found: string[] = [];
  const missing: string[] = [];

  for (const skillName of skillNames) {
    const skillPath = path.join(
      repositoryPath,
      ".agents",
      "skills",
      skillName,
      "SKILL.md",
    );

    if (skillExists(skillPath)) {
      found.push(skillName);
    } else {
      missing.push(skillName);
    }
  }

  return {
    checked: true,
    found,
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
  const type = getStringField(object, "type", "event", "name", "kind");
  const normalizedType = normalizeText(type);
  const status = normalizeText(getStringField(object, "status", "state", "outcome"));
  const level = normalizeText(getStringField(object, "level", "severity"));
  const role = normalizeText(getStringField(object, "role"));
  const message = extractMessage(object);
  const command = getStringField(object, "command", "cmd");
  const exitCode = getNumberField(object, "exit_code", "exitCode", "code");
  const files = extractChangedFilesFromObject(object);

  if (level === "warn" || level === "warning") {
    return {
      kind: "warning",
      message: message || "Codex emitted a warning.",
    };
  }

  if (level === "error") {
    return {
      kind: isFailedSkillLookup(message) ? "warning" : "error",
      message: message || "Codex emitted an error.",
    };
  }

  if (
    normalizedType.includes("session") ||
    normalizedType.includes("thread") ||
    normalizedType.includes("conversation")
  ) {
    if (isStarted(normalizedType, status)) {
      return {
        kind: "codex_session_started",
        message: message || "Codex session started.",
      };
    }
  }

  if (normalizedType.includes("command") || command) {
    if (isFailed(normalizedType, status) || (typeof exitCode === "number" && exitCode !== 0)) {
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

    if (isStarted(normalizedType, status)) {
      return {
        command,
        kind: "command_started",
        message: message || formatCommandMessage(command, "started"),
      };
    }
  }

  if (normalizedType.includes("patch") || hasDiff(message)) {
    const diffFingerprint = message ? normalizeDiff(message) : null;

    if (diffFingerprint) {
      if (seenDiffs.has(diffFingerprint)) {
        return null;
      }

      seenDiffs.add(diffFingerprint);
    }

    return {
      files,
      kind: "patch_applied",
      message: message || formatFilesMessage(files, "Patch applied."),
    };
  }

  if (files.length > 0 || normalizedType.includes("file")) {
    return {
      files,
      kind: "file_changed",
      message: message || formatFilesMessage(files, "File changed."),
    };
  }

  if (
    role === "assistant" &&
    (normalizedType.includes("message") || normalizedType.includes("response")) &&
    message
  ) {
    return {
      kind: "final_assistant_message",
      message,
    };
  }

  if (isFailed(normalizedType, status)) {
    return {
      kind: isFailedSkillLookup(message) ? "warning" : "error",
      message: message || "Codex reported a failure.",
    };
  }

  if (message && isFailedSkillLookup(message)) {
    return {
      kind: "warning",
      message,
    };
  }

  return null;
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

  for (const key of ["file", "path", "filename"]) {
    const value = object[key];

    if (typeof value === "string" && looksLikePath(value)) {
      files.add(shortenPath(value));
    }
  }

  for (const key of ["files", "paths", "changed_files", "changedFiles"]) {
    const value = object[key];

    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && looksLikePath(item)) {
          files.add(shortenPath(item));
        }
      }
    }
  }

  const message = extractMessage(object);

  for (const filePath of extractPathsFromText(message)) {
    files.add(filePath);
  }

  return Array.from(files).sort((first, second) => first.localeCompare(second));
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

function formatFilesMessage(files: string[], fallback: string): string {
  return files.length > 0 ? `${fallback} ${files.join(", ")}` : fallback;
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
