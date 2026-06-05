import { TextDecoder } from "node:util";
import { expect } from "vitest";

export function parseSsePayloads(text: string, eventName: string): unknown[] {
  return text
    .trim()
    .split("\n\n")
    .filter((block) => block.startsWith(`event: ${eventName}\n`))
    .map((block) => {
      const dataLine = block.split("\n").find((line) => line.startsWith("data: "));

      if (!dataLine) {
        throw new Error(`Missing data line for SSE event ${eventName}.`);
      }

      return JSON.parse(dataLine.slice("data: ".length)) as unknown;
    });
}

export async function readSseChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<string> {
  const result = await reader.read();

  if (result.done) {
    throw new Error("SSE stream ended before sending an event.");
  }

  return new TextDecoder().decode(result.value);
}

export async function readSseSnapshot(origin: string): Promise<string> {
  const response = await globalThis.fetch(`${origin}/api/events`);
  const reader = response.body?.getReader();

  expect(response.status).toBe(200);
  expect(reader).toBeDefined();

  if (!reader) {
    throw new Error("Missing SSE response body.");
  }

  const chunk = await readSseChunk(reader);
  await reader.cancel();
  return chunk;
}

export async function readUntilSsePayloads(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  eventName: string,
): Promise<unknown[]> {
  let text = "";

  for (let attempt = 0; attempt < 10; attempt += 1) {
    text += await readSseChunk(reader);

    const payloads = parseSsePayloads(text, eventName);

    if (payloads.length > 0) {
      return payloads;
    }
  }

  throw new Error(`SSE stream did not send an event named ${eventName}.`);
}
