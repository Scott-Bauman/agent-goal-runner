# Provider Stream Contracts

Captured for Phase 1 of `goal.md`.

## Codex

- Local CLI: `codex-cli 0.139.0`; `codex exec --version` reports `codex-cli-exec 0.139.0`.
- Streaming command shape: `codex exec --json [--output-last-message <file>] [PROMPT]`.
- `codex exec --help` documents `--json` as JSONL event output on stdout and `--output-last-message <FILE>` as the last-agent-message capture path.
- No credential-free real Codex run sample was captured. Existing parser tests use representative JSONL objects until a real stream can be collected.

## Claude Code

- No local `claude` executable was found on PATH during Phase 1.
- Official CLI target: `claude -p "<prompt>" --output-format stream-json --verbose --include-partial-messages`.
- `--output-format` accepts `text`, `json`, and `stream-json` in print mode.
- `--include-partial-messages` requires `--print` and `--output-format stream-json`.
- Official stream events include `system/init`, `system/api_retry`, `stream_event` wrappers around API events such as `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, and `message_stop`, plus final result messages.
- Source: https://code.claude.com/docs/en/headless and https://code.claude.com/docs/en/agent-sdk/streaming-output

## Pi

- Local CLI: `pi --version` reports `0.79.3`.
- Streaming command shape: `pi --mode json [--model <id>] <prompt>`.
- `pi --help` documents `--mode json`, `--model <pattern>`, and trust flags `--approve` / `--no-approve`.
- Preserve current trust behavior by not passing either trust flag automatically.
- Installed docs at `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/json.md` describe JSONL on stdout.
- Documented Pi event types include `session`, `agent_start`, `turn_start`, `message_start`, `message_update`, `message_end`, `turn_end`, `agent_end`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`, `queue_update`, `compaction_start`, `compaction_end`, `auto_retry_start`, and `auto_retry_end`.
- Pi JSON mode has no documented active approval response channel. Runs are non-interactive, so provider approvals, trust, sandboxing, and credentials must be configured before the loop starts.

Small documented JSONL shape:

```jsonl
{"type":"session","version":3,"id":"uuid","timestamp":"...","cwd":"/path"}
{"type":"agent_start"}
{"type":"turn_start"}
{"type":"message_update","message":{},"assistantMessageEvent":{"type":"text_delta","delta":"Hello"}}
{"type":"tool_execution_start","toolCallId":"tool-1","toolName":"bash","args":{"command":"ls"}}
{"type":"tool_execution_end","toolCallId":"tool-1","toolName":"bash","result":{"stdout":"README.md\n"},"isError":false}
{"type":"turn_end","message":{},"toolResults":[]}
{"type":"agent_end","messages":[]}
```
