import { describe, expect, it } from "vitest";

import { ClaudeJsonEventParser } from "../../../src/server/runner/claudeJsonEvents";

describe("Claude JSON event parsing", () => {
  it("parses incremental JSONL and ignores invalid or empty lines", () => {
    const parser = new ClaudeJsonEventParser();

    expect(
      parser.push(
        `${JSON.stringify({
          type: "system",
          subtype: "init",
          session_id: "session-1",
          model: "claude-sonnet-4-5",
        })}\n\nnot-json\n{"type":`,
      ),
    ).toEqual({
      events: [
        {
          kind: "agent_session_started",
          message: "Claude session started: session-1",
        },
      ],
      metadata: {
        model: "claude-sonnet-4-5",
      },
    });

    expect(parser.push('"system","subtype":"api_retry","error":"rate limited"}\n')).toEqual({
      events: [
        {
          kind: "warning",
          message: "Claude API retry: rate limited",
        },
      ],
      metadata: {},
    });
  });

  it("emits one final assistant message from assistant text and result events", () => {
    const parser = new ClaudeJsonEventParser();
    const assistantLine = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-1",
        content: [
          {
            type: "text",
            text: "Done.",
          },
        ],
        stop_reason: "end_turn",
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
      },
    });
    const resultLine = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "Done.",
      usage: {
        input_tokens: 12,
        output_tokens: 7,
      },
    });

    const parsed = parser.push(`${assistantLine}\n${resultLine}\n`);

    expect(parsed.events).toEqual([
      {
        kind: "final_assistant_message",
        message: "Done.",
      },
    ]);
    expect(parsed.metadata).toEqual({
      model: "claude-opus-4-1",
      stopReason: "end_turn",
      tokenCount: 19,
    });
    expect(parser.flush().events).toEqual([]);
    expect(parser.getFinalAssistantMessage()).toBe("Done.");
  });

  it("flushes assistant text as the final message when no result event arrives", () => {
    const parser = new ClaudeJsonEventParser();

    expect(
      parser.push(
        `${JSON.stringify({
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              {
                type: "text",
                text: "I finished the narrow change.",
              },
            ],
          },
        })}\n`,
      ).events,
    ).toEqual([]);

    expect(parser.flush().events).toEqual([
      {
        kind: "final_assistant_message",
        message: "I finished the narrow change.",
      },
    ]);
  });

  it("accumulates streamed text deltas without emitting noisy partial rows", () => {
    const parser = new ClaudeJsonEventParser();

    const parsed = parser.push(
      [
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_start",
            index: 0,
            content_block: {
              type: "text",
              text: "",
            },
          },
        }),
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            index: 0,
            delta: {
              type: "text_delta",
              text: "Nearly ",
            },
          },
        }),
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            index: 0,
            delta: {
              type: "text_delta",
              text: "done.",
            },
          },
        }),
      ].join("\n") + "\n",
    );

    expect(parsed.events).toEqual([]);
    expect(parser.flush().events).toEqual([
      {
        kind: "final_assistant_message",
        message: "Nearly done.",
      },
    ]);
  });

  it("parses command tool starts and results with failure text", () => {
    const parser = new ClaudeJsonEventParser();
    const parsed = parser.push(
      [
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_start",
            index: 0,
            content_block: {
              type: "tool_use",
              id: "tool-1",
              name: "Bash",
              input: {
                command: "npm test",
              },
            },
          },
        }),
        JSON.stringify({
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool-1",
                is_error: true,
                content: [
                  {
                    type: "text",
                    text: "stderr: one test failed",
                  },
                ],
              },
            ],
          },
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
        kind: "command_failed",
        message: "Command failed: npm test\nstderr: one test failed",
      },
    ]);
  });

  it("parses generic tool starts and successful results", () => {
    const parser = new ClaudeJsonEventParser();
    const parsed = parser.push(
      [
        JSON.stringify({
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "tool-2",
                name: "Read",
                input: {
                  file_path: "src/server/runner/agentRunner.ts",
                },
              },
            ],
          },
        }),
        JSON.stringify({
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "tool-2",
                name: "Read",
                input: {
                  file_path: "src/server/runner/agentRunner.ts",
                },
              },
            ],
          },
        }),
        JSON.stringify({
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool-2",
                is_error: false,
                content: "file contents",
              },
            ],
          },
        }),
        JSON.stringify({
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool-2",
                is_error: false,
                content: "file contents",
              },
            ],
          },
        }),
      ].join("\n") + "\n",
    );

    expect(parsed.events).toEqual([
      {
        kind: "tool_started",
        message: "Tool started: Read (src/server/runner/agentRunner.ts)",
        toolName: "Read",
      },
      {
        kind: "tool_succeeded",
        message: "Tool succeeded: Read (src/server/runner/agentRunner.ts)",
        toolName: "Read",
      },
    ]);
    expect(parsed.metadata).toEqual({});
  });

  it("parses file edit tool results into patch rows when paths are available", () => {
    const parser = new ClaudeJsonEventParser();
    const parsed = parser.push(
      [
        JSON.stringify({
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "tool-3",
                name: "Edit",
                input: {
                  file_path: "/Users/scottbauman/CodingProjects/agent-goal-runner/src/web/App.tsx",
                  old_string: "before",
                  new_string: "after",
                },
              },
            ],
          },
        }),
        JSON.stringify({
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool-3",
                is_error: false,
                content: "The file src/web/App.tsx has been updated.",
              },
            ],
          },
        }),
      ].join("\n") + "\n",
    );

    expect(parsed.events).toEqual([
      {
        kind: "tool_started",
        message: "Tool started: Edit (src/web/App.tsx)",
        toolName: "Edit",
      },
      {
        kind: "tool_succeeded",
        message: "Tool succeeded: Edit (src/web/App.tsx)",
        toolName: "Edit",
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

  it("extracts metadata from stream events and failure result events", () => {
    const parser = new ClaudeJsonEventParser();
    const parsed = parser.push(
      [
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "message_start",
            message: {
              model: "claude-haiku-4-5",
              usage: {
                input_tokens: 100,
                output_tokens: 25,
              },
            },
          },
        }),
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "message_delta",
            delta: {
              stop_reason: "max_tokens",
            },
          },
        }),
        JSON.stringify({
          type: "result",
          subtype: "error_max_turns",
          is_error: true,
          error: "Maximum turns reached",
        }),
      ].join("\n") + "\n",
    );

    expect(parsed.events).toEqual([
      {
        kind: "error",
        message: "Maximum turns reached",
        stopReason: "Maximum turns reached",
      },
    ]);
    expect(parsed.metadata).toEqual({
      model: "claude-haiku-4-5",
      stopReason: "max_tokens",
      tokenCount: 125,
    });
  });
});
