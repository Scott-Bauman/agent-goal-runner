import {
  classifyTranscriptMessage,
  type TranscriptEventKind,
} from "@/web/events/runtimeStream";

export type LogActivityKind = TranscriptEventKind;

export function classifyLogMessage(message: string): LogActivityKind {
  return classifyTranscriptMessage(message);
}
