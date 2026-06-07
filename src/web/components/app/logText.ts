import type { RuntimeTranscriptEntry } from "@/web/events/runtimeStream";

export type MessageSegment =
  | {
      text: string;
      type: "text";
    }
  | {
      language: string | null;
      text: string;
      type: "code";
    };

export type PathTextPart =
  | {
      text: string;
      type: "text";
    }
  | {
      fullPath: string;
      text: string;
      type: "path";
    };

const REPO_PATH_MARKERS = ["/src/", "/tests/", "/scripts/", "/docs/", "/.agents/"];
const WINDOWS_PATH_PATTERN =
  /[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\s\r\n]+/g;
const RELATIVE_PATH_PATTERN =
  /(?:^|[\s"'`(])((?:\.{1,2}[\\/])?(?:(?:src|tests|scripts|docs|\.agents)[\\/])(?:[^\s"'`()]+[\\/])*[^\s"'`()]+\.[A-Za-z0-9]+)/g;

export function parseFencedMessage(message: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  const fencePattern = /```([A-Za-z0-9_-]+)?\r?\n?([\s\S]*?)```/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = fencePattern.exec(message)) !== null) {
    if (match.index > cursor) {
      segments.push({
        text: message.slice(cursor, match.index),
        type: "text",
      });
    }

    segments.push({
      language: match[1] ?? null,
      text: match[2]?.replace(/\s+$/, "") ?? "",
      type: "code",
    });
    cursor = match.index + match[0].length;
  }

  if (cursor < message.length) {
    segments.push({
      text: message.slice(cursor),
      type: "text",
    });
  }

  return segments.length > 0 ? segments : [{ text: message, type: "text" }];
}

export function shortenLogPath(path: string): string {
  const normalizedPath = path.replaceAll("\\", "/");
  const repositoryIndex = normalizedPath
    .toLowerCase()
    .lastIndexOf("/agent-goal-runner/");

  if (repositoryIndex >= 0) {
    return normalizedPath.slice(repositoryIndex + "/agent-goal-runner/".length);
  }

  for (const marker of REPO_PATH_MARKERS) {
    const markerIndex = normalizedPath.indexOf(marker);

    if (markerIndex >= 0) {
      return normalizedPath.slice(markerIndex + 1);
    }
  }

  for (const marker of REPO_PATH_MARKERS) {
    const relativeMarker = marker.slice(1);

    if (normalizedPath.startsWith(relativeMarker)) {
      return normalizedPath;
    }
  }

  const pathParts = normalizedPath.split("/").filter(Boolean);
  return pathParts.length > 3 ? pathParts.slice(-3).join("/") : normalizedPath;
}

export function splitTextByPaths(text: string): PathTextPart[] {
  const pathMatches: Array<{
    fullPath: string;
    index: number;
    length: number;
  }> = [];

  for (const match of text.matchAll(WINDOWS_PATH_PATTERN)) {
    pathMatches.push({
      fullPath: match[0],
      index: match.index ?? 0,
      length: match[0].length,
    });
  }

  for (const match of text.matchAll(RELATIVE_PATH_PATTERN)) {
    const matchedPath = match[1];
    const matchIndex = (match.index ?? 0) + match[0].indexOf(matchedPath);

    pathMatches.push({
      fullPath: matchedPath,
      index: matchIndex,
      length: matchedPath.length,
    });
  }

  pathMatches.sort((first, second) => first.index - second.index);

  const parts: PathTextPart[] = [];
  let cursor = 0;

  for (const match of pathMatches) {
    if (match.index < cursor) {
      continue;
    }

    if (match.index > cursor) {
      parts.push({
        text: text.slice(cursor, match.index),
        type: "text",
      });
    }

    parts.push({
      fullPath: match.fullPath,
      text: shortenLogPath(match.fullPath),
      type: "path",
    });
    cursor = match.index + match.length;
  }

  if (cursor < text.length) {
    parts.push({
      text: text.slice(cursor),
      type: "text",
    });
  }

  return parts.length > 0 ? parts : [{ text, type: "text" }];
}

export function extractChangedFiles(
  logs: RuntimeTranscriptEntry[] | string[],
): string[] {
  const messages = logs.map((entry) =>
    typeof entry === "string" ? entry : entry.message,
  );
  const changedFiles = new Set<string>();

  for (const message of messages) {
    for (const part of splitTextByPaths(message)) {
      if (part.type === "path") {
        changedFiles.add(part.text);
      }
    }
  }

  return Array.from(changedFiles).sort((first, second) =>
    first.localeCompare(second),
  );
}
