import { describe, expect, it } from "vitest";

import { PiJsonEventParser } from "../../../src/server/runner/piJsonEvents";

describe("Pi JSON event parsing", () => {
  it("parses incremental JSONL and ignores invalid or empty lines", () => {
    const parser = new PiJsonEventParser();

    expect(
      parser.push(
        `${JSON.stringify({
          type: "session",
          id: "session-1",
          model: "gpt-5",
        })}\n\nnot-json\n{"type":`,
      ),
    ).toEqual({
      events: [
        {
          kind: "agent_session_started",
          message: "Pi session started: session-1",
        },
      ],
      metadata: {
        model: "gpt-5",
      },
    });

    expect(parser.push('"agent_start"}\n')).toEqual({
      events: [
        {
          kind: "agent_session_started",
          message: "Pi agent started.",
        },
      ],
      metadata: {},
    });
  });

  it("parses lifecycle events into normalized rows", () => {
    const parser = new PiJsonEventParser();

    expect(
      parser.push(
        [
          JSON.stringify({
            type: "session",
            id: "session-2",
          }),
          JSON.stringify({
            type: "agent_start",
          }),
          JSON.stringify({
            type: "turn_start",
          }),
        ].join("\n") + "\n",
      ).events,
    ).toEqual([
      {
        kind: "agent_session_started",
        message: "Pi session started: session-2",
      },
      {
        kind: "agent_session_started",
        message: "Pi agent started.",
      },
      {
        kind: "agent_session_started",
        message: "Pi turn started.",
      },
    ]);
  });

  it("accumulates message deltas without emitting noisy partial rows", () => {
    const parser = new PiJsonEventParser();

    const parsed = parser.push(
      [
        JSON.stringify({
          type: "message_start",
          message: {
            role: "assistant",
            content: [],
          },
        }),
        JSON.stringify({
          type: "message_update",
          message: {
            role: "assistant",
            content: [],
          },
          assistantMessageEvent: {
            type: "text_delta",
            delta: "Almost ",
          },
        }),
        JSON.stringify({
          type: "message_update",
          message: {
            role: "assistant",
            content: [],
          },
          assistantMessageEvent: {
            type: "text_delta",
            delta: "done.",
          },
        }),
      ].join("\n") + "\n",
    );

    expect(parsed.events).toEqual([]);
    expect(parser.flush().events).toEqual([
      {
        kind: "final_assistant_message",
        message: "Almost done.",
      },
    ]);
    expect(parser.getFinalAssistantMessage()).toBe("Almost done.");
  });

  it("emits one final assistant message from message_end, turn_end, and agent_end", () => {
    const parser = new PiJsonEventParser();
    const parsed = parser.push(
      [
        JSON.stringify({
          type: "message_end",
          message: {
            role: "assistant",
            content: [
              {
                type: "text",
                text: "Done.",
              },
            ],
          },
        }),
        JSON.stringify({
          type: "turn_end",
          message: {
            role: "assistant",
            content: "Done.",
          },
          toolResults: [],
        }),
        JSON.stringify({
          type: "agent_end",
          messages: [
            {
              role: "user",
              content: "Please do it.",
            },
            {
              role: "assistant",
              content: "Done.",
            },
          ],
        }),
      ].join("\n") + "\n",
    );

    expect(parsed.events).toEqual([
      {
        kind: "final_assistant_message",
        message: "Done.",
      },
    ]);
    expect(parser.flush().events).toEqual([]);
  });

  it("parses command tool execution starts and successful completions", () => {
    const parser = new PiJsonEventParser();
    const parsed = parser.push(
      [
        JSON.stringify({
          type: "tool_execution_start",
          toolCallId: "tool-1",
          toolName: "bash",
          args: {
            command: "npm test",
          },
        }),
        JSON.stringify({
          type: "tool_execution_end",
          toolCallId: "tool-1",
          toolName: "bash",
          result: {
            stdout: "ok",
          },
          isError: false,
        }),
      ].join("\n") + "\n",
    );

    expect(parsed.events).toEqual([
      {
        command: "npm test",
        kind: "command_started",
        message: "Command started: npm test",
      },
      {
        command: "npm test",
        kind: "command_succeeded",
        message: "Command succeeded: npm test",
      },
    ]);
  });

  it("parses tool execution updates and edit completions with changed files", () => {
    const parser = new PiJsonEventParser();
    const parsed = parser.push(
      [
        JSON.stringify({
          type: "tool_execution_start",
          toolCallId: "tool-2",
          toolName: "write",
          args: {
            path: "/Users/scottbauman/CodingProjects/agent-goal-runner/src/web/App.tsx",
          },
        }),
        JSON.stringify({
          type: "tool_execution_update",
          toolCallId: "tool-2",
          toolName: "write",
          args: {
            path: "/Users/scottbauman/CodingProjects/agent-goal-runner/src/web/App.tsx",
          },
          partialResult: {
            path: "src/web/App.tsx",
          },
        }),
        JSON.stringify({
          type: "tool_execution_end",
          toolCallId: "tool-2",
          toolName: "write",
          result: {
            path: "src/web/App.tsx",
            message: "Wrote src/web/App.tsx",
          },
          isError: false,
        }),
      ].join("\n") + "\n",
    );

    expect(parsed.events).toEqual([
      {
        kind: "tool_started",
        message: "Tool started: write (src/web/App.tsx)",
        toolName: "write",
      },
      {
        files: ["src/web/App.tsx"],
        kind: "file_changed",
        message: "File changed. src/web/App.tsx",
      },
      {
        kind: "tool_succeeded",
        message: "Tool succeeded: write (src/web/App.tsx)",
        toolName: "write",
      },
      {
        files: ["src/web/App.tsx"],
        kind: "patch_applied",
        message: "Patch applied. src/web/App.tsx",
      },
    ]);
    expect(parsed.metadata).toEqual({
      changedFiles: ["src/web/App.tsx"],
    });
  });

  it("parses tool result errors into failed rows with concise text", () => {
    const parser = new PiJsonEventParser();
    const parsed = parser.push(
      [
        JSON.stringify({
          type: "tool_execution_start",
          toolCallId: "tool-3",
          toolName: "Read",
          args: {
            path: "src/server/runner/piJsonEvents.ts",
          },
        }),
        JSON.stringify({
          type: "tool_execution_end",
          toolCallId: "tool-3",
          toolName: "Read",
          result: {
            errorMessage: "File not found",
          },
          isError: true,
        }),
      ].join("\n") + "\n",
    );

    expect(parsed.events).toEqual([
      {
        kind: "tool_started",
        message: "Tool started: Read (src/server/runner/piJsonEvents.ts)",
        toolName: "Read",
      },
      {
        kind: "tool_failed",
        message: "Tool failed: Read (src/server/runner/piJsonEvents.ts)\nFile not found",
        toolName: "Read",
      },
    ]);
  });

  it("parses compaction and retry events into concise warning and error rows", () => {
    const parser = new PiJsonEventParser();
    const parsed = parser.push(
      [
        JSON.stringify({
          type: "compaction_start",
          reason: "threshold",
        }),
        JSON.stringify({
          type: "compaction_end",
          reason: "threshold",
          aborted: false,
          willRetry: true,
        }),
        JSON.stringify({
          type: "auto_retry_start",
          attempt: 1,
          maxAttempts: 3,
          errorMessage: "context overflow",
        }),
        JSON.stringify({
          type: "auto_retry_end",
          success: false,
          attempt: 1,
          finalError: "still overflowing",
        }),
      ].join("\n") + "\n",
    );

    expect(parsed.events).toEqual([
      {
        kind: "warning",
        message: "Pi compaction started: threshold.",
      },
      {
        kind: "warning",
        message: "Pi compaction finished: threshold. Will retry.",
      },
      {
        kind: "warning",
        message: "Pi retry 1/3 scheduled: context overflow",
      },
      {
        kind: "error",
        message: "Pi retry 1 failed: still overflowing",
        stopReason: "still overflowing",
      },
    ]);
  });

  it("extracts metadata from message usage and nested changed-file paths", () => {
    const parser = new PiJsonEventParser();
    const parsed = parser.push(
      `${JSON.stringify({
        type: "turn_end",
        message: {
          role: "assistant",
          content: "Finished.",
          model: "gpt-5-mini",
          stopReason: "end_turn",
          usage: {
            input_tokens: 30,
            output_tokens: 12,
          },
        },
        toolResults: [
          {
            toolCallId: "tool-4",
            toolName: "edit",
            result: {
              changes: [
                {
                  path: "/Users/scottbauman/CodingProjects/agent-goal-runner/tests/server/runner/piJsonEvents.test.ts",
                },
              ],
            },
            isError: false,
          },
        ],
      })}\n`,
    );

    expect(parsed.events).toEqual([
      {
        kind: "final_assistant_message",
        message: "Finished.",
      },
      {
        kind: "tool_started",
        message: "Tool started: edit (tests/server/runner/piJsonEvents.test.ts)",
        toolName: "edit",
      },
      {
        kind: "tool_succeeded",
        message: "Tool succeeded: edit (tests/server/runner/piJsonEvents.test.ts)",
        toolName: "edit",
      },
      {
        files: ["tests/server/runner/piJsonEvents.test.ts"],
        kind: "patch_applied",
        message: "Patch applied. tests/server/runner/piJsonEvents.test.ts",
      },
    ]);
    expect(parsed.metadata).toEqual({
      changedFiles: ["tests/server/runner/piJsonEvents.test.ts"],
      model: "gpt-5-mini",
      stopReason: "end_turn",
      tokenCount: 42,
    });
  });
});
