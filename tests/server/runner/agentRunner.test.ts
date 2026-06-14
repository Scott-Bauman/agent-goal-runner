import { describe, expect, it } from "vitest";

import { createPiRawStdoutFilter } from "../../../src/server/runner/agentRunner";

describe("agent runner raw stdout filtering", () => {
  it("drops Pi message update JSONL rows from raw stdout", () => {
    const filter = createPiRawStdoutFilter();
    const sessionLine = JSON.stringify({
      type: "session",
      id: "session-1",
    });
    const firstPartialLine = JSON.stringify({
      type: "message_update",
      assistantMessageEvent: {
        type: "thinking_delta",
        delta: "Hello",
      },
      message: {
        role: "assistant",
        content: "Hello",
      },
    });
    const secondPartialLine = JSON.stringify({
      type: "message_update",
      assistantMessageEvent: {
        type: "thinking_delta",
        delta: " world",
      },
      message: {
        role: "assistant",
        content: "Hello world",
      },
    });

    expect(
      filter.push(`${sessionLine}\n${firstPartialLine}\n${secondPartialLine}\n`),
    ).toBe(`${sessionLine}\n`);
    expect(filter.flush()).toBeNull();
  });

  it("keeps Pi lifecycle, tool, and final message JSONL rows", () => {
    const filter = createPiRawStdoutFilter();
    const retainedLines = [
      JSON.stringify({
        type: "agent_start",
      }),
      JSON.stringify({
        type: "tool_execution_start",
        toolName: "bash",
      }),
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: "Done.",
        },
      }),
      JSON.stringify({
        type: "turn_end",
      }),
      JSON.stringify({
        type: "agent_end",
      }),
    ];

    expect(filter.push(`${retainedLines.join("\n")}\n`)).toBe(
      `${retainedLines.join("\n")}\n`,
    );
    expect(filter.flush()).toBeNull();
  });

  it("keeps non-JSON stdout unchanged", () => {
    const filter = createPiRawStdoutFilter();

    expect(filter.push("plain output\n")).toBe("plain output\n");
    expect(filter.push("partial plain output")).toBeNull();
    expect(filter.flush()).toBe("partial plain output");
  });

  it("handles JSONL split across multiple chunks", () => {
    const filter = createPiRawStdoutFilter();
    const messageUpdateLine = JSON.stringify({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: "partial",
      },
    });
    const toolEndLine = JSON.stringify({
      type: "tool_execution_end",
      toolName: "bash",
      isError: false,
    });

    expect(filter.push(messageUpdateLine.slice(0, 24))).toBeNull();
    expect(
      filter.push(`${messageUpdateLine.slice(24)}\n${toolEndLine.slice(0, 16)}`),
    ).toBeNull();
    expect(filter.push(`${toolEndLine.slice(16)}\n`)).toBe(`${toolEndLine}\n`);
    expect(filter.flush()).toBeNull();
  });
});
