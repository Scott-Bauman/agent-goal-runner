# Agent Output Streaming Goal

## Goal

Implement TUI-like public agent activity in the browser Agent Output panel for Codex, Claude Code, and Pi.

The browser should show live, useful progress while a run is active: session starts, partial assistant text when available, tool/command starts and completions, file edits, warnings, errors, compaction/retry events, final assistant output, and run completion. Hidden chain-of-thought is not available and must not be exposed or simulated.

MVP: Codex continues using `codex exec --json`; Claude Code uses documented streaming JSON output; Pi uses documented JSON event mode. All three providers feed normalized run events into the existing SSE and transcript pipeline without duplicate final/completion rows.

## Scope

### In Scope

- Preserve the current run loop, SSE route, run status, progress, summary, and raw log architecture.
- Keep provider-specific CLI argument construction under `src/server/runner/*Command.ts`.
- Add provider-specific JSONL parsers for Claude Code and Pi, modeled after the existing Codex parser pattern.
- Expand normalized run event handling only as needed to represent public live activity from Claude Code and Pi.
- Continue storing raw stdout/stderr logs for debugging, while keeping structured JSONL out of the main transcript.
- Show one canonical final assistant row and one canonical completion row in the user-facing transcript.
- Keep print-mode fallback behavior only if a provider has no usable streaming JSON mode at runtime.
- Preserve Pi's current project trust behavior by default; do not pass `--approve` or `--no-approve` automatically.
- Add a compact pre-run notice that provider runs are non-interactive and approvals, trust, sandboxing, and credentials must be configured before starting a loop.
- Use a hybrid assistant-text MVP: show live tool/command/file/status activity, avoid token-by-token transcript spam, and render final assistant output once.
- Add tests for command construction, parser behavior, run controller wiring, SSE payloads, and visible transcript behavior.

### Out of Scope

- Displaying hidden chain-of-thought, private reasoning tokens, or simulated internal thinking.
- Building a PTY scraper for interactive TUIs unless streaming JSON is proven unusable.
- Mediating provider approval prompts from the browser during an active run.
- Auto-discovering local Pi models from `~/.pi/agent/models.json`.
- Adding new credentials, telemetry, hosted services, or remote log upload.
- Automatically approving Pi trust prompts, install commands, downloads, or web access without an explicit user choice.
- Redesigning the whole Agent Output UI beyond controls/states needed for live activity.
- Changing goal execution, auto-commit, review cadence, branch handling, or verification behavior except where provider event streaming requires it.

## Product Shape

- Primary surface: existing browser Agent Output panel.
- Main workflow: user starts a provider run and can see public activity within seconds, not only at final completion.
- UX priority: observability, low duplication, clear status, and graceful fallback when a CLI emits little or no stream data.
- Raw Logs remain collapsible debugging detail; the transcript remains the clean human-readable feed.
- Run setup includes a compact notice near provider selection: provider runs are non-interactive, so users should configure provider approvals, trust, sandboxing, and credentials before starting the loop.

## Execution Rules

- Use this `goal.md` as the source of truth.
- Complete the next valid unchecked item only.
- A valid item is the first unchecked checkbox whose dependencies are complete and whose work can be safely completed in one focused pass.
- Do not broaden scope beyond the selected checkbox.
- Do not scaffold future phases unless required by the selected checkbox.
- Keep each change independently verifiable.
- Update only the relevant checkbox state after verified completion.
- Do not add run logs, reasoning traces, or routine progress notes to this file.
- Split oversized checklist items before implementing them.
- Do not rename public APIs, persisted keys, routes, SSE event names, exported functions, props, or files unless explicitly required by the selected item.
- Preserve existing behavior for Codex, Claude print output, Pi print output, verification commands, review runs, and auto-commit unless the selected item explicitly changes it.
- Do not pass provider trust or approval-bypass flags automatically.

## Scope Inventory

- `src/server/runner/codexCommand.ts`: existing Codex `exec --json` command builder; preserve and polish only if needed.
- `src/server/runner/codexJsonEvents.ts`: existing Codex JSONL parser and useful normalization pattern.
- `src/server/runner/claudeCommand.ts`: change Claude command construction from print-only to streaming JSON when enabled.
- `src/server/runner/piCommand.ts`: change Pi command construction from print-only to JSON mode when enabled.
- `src/server/runner/agentRunner.ts`: provider runner orchestration, stdout/stderr handling, parser hookup, final-message extraction.
- `src/server/runner/runController.ts`: run event publication, final assistant handling, process close behavior.
- `src/server/sse/types.ts` and `src/server/sse/sseHub.ts`: shared event payload contract and run detail updates.
- `src/web/events/runtimeStream.ts`: transcript normalization, raw-log filtering, duplicate suppression.
- `src/web/components/app/LogConsole.tsx`: visible transcript rendering and active-run affordances.
- `src/web/components/app/ControlsPanel.tsx`: provider selection and non-interactive-run notice.
- `src/server/routes/runRoutes.ts`: run start validation and response shape.
- `tests/server/runner/*`: command builder and parser tests.
- `tests/server/routes/runRoutes.test.ts` and `tests/server/runner/runController.test.ts`: provider wiring and SSE behavior tests.
- `tests/web/events/runtimeStream.test.ts` and component tests: transcript behavior tests.

## Implementation Plan

### Phase 1: Confirm Provider Stream Contracts

- [x] Capture the installed Codex CLI version and `codex exec --help` options relevant to `--json` and `--output-last-message`.
- [x] Capture Claude Code streaming options from official docs or installed `claude --help`; record the exact flags needed for JSON streaming in Durable Notes.
- [x] Capture Pi JSON mode options from installed docs or `pi --help`; record the exact flags needed for JSON streaming in Durable Notes.
- [x] Add small parser fixture notes or sample JSONL snippets for Codex, Claude, and Pi under tests if real samples are available without credentials.

### Phase 2: Normalize Public Activity Events

- [x] Audit current `RunEventKind` values and list which existing kinds can represent command/tool starts, command/tool completions, file changes, warnings, errors, final assistant messages, and run completion.
- [x] Add only the minimal new `RunEventKind` values needed for provider-agnostic live activity that cannot be represented today.
- [x] Update `RunEventPayload`, SSE serialization, run details aggregation, and transcript kind mapping for any new event kinds.
- [x] Add tests proving old event kinds and any new event kinds update changed files, warning/error counts, stop reason, and last assistant message correctly.

### Phase 3: Codex Parser Polish

- [x] Review `CodexJsonEventParser` against current Codex JSONL samples and identify any public activity currently ignored that should appear in the transcript.
- [x] Extend Codex parsing only for concrete observed fields or documented event shapes.
- [x] Preserve filtering of raw structured Codex JSONL from the visible transcript while keeping it in Raw Logs.
- [x] Add focused Codex parser tests for any newly supported event shapes.

### Phase 4: Claude Streaming JSON Command

- [x] Add a Claude command builder path for streaming JSON output using the documented `claude -p --output-format stream-json --verbose` style flags.
- [x] Preserve model selection behavior for Claude.
- [x] Keep a clearly named print-mode builder only if tests or fallback behavior still require it.
- [x] Update Claude command tests to cover streaming JSON arguments and existing Windows package-bin resolution.

### Phase 5: Claude Streaming JSON Parser

- [x] Create `src/server/runner/claudeJsonEvents.ts` with an incremental JSONL parser that tolerates chunk boundaries and ignores invalid/empty lines.
- [x] Parse Claude session/system lifecycle events into normalized run events where useful.
- [x] Parse Claude assistant text/final result events into a single final assistant message without duplicating streamed deltas.
- [x] Parse Claude tool/command start events into normalized command/tool start rows with useful labels.
- [x] Parse Claude tool/command result events into success/failure rows, including stderr/error text when available.
- [x] Parse Claude file edit indicators into changed-file or patch-applied rows only when file paths are available.
- [x] Extract model, stop reason, and token usage metadata when emitted.
- [x] Add parser tests using representative JSONL objects for text, tool use, tool result, failure, and metadata.

### Phase 6: Wire Claude Runner

- [x] Update `claudeRunner` to spawn the streaming JSON command by default.
- [x] Feed Claude stdout to raw logs and the Claude JSON parser; emit parsed run events and metadata through existing hooks.
- [x] Keep stderr visible as raw/process logs and warnings/errors where appropriate.
- [x] Ensure `complete()` flushes parser remainder and returns the final assistant message captured from stream state.
- [x] Add run controller tests proving Claude emits live run events before process close.

### Phase 7: Pi JSON Command

- [x] Add a Pi command builder path for `pi --mode json <prompt>`.
- [x] Preserve optional `--model <id>` behavior for Pi.
- [x] Preserve Pi's current project trust behavior; do not pass `--approve` or `--no-approve` by default.
- [x] Keep a clearly named print-mode builder only if tests or fallback behavior still require it.
- [x] Update Pi command tests to cover JSON mode arguments, optional model, and existing Windows package-bin resolution.

### Phase 8: Pi JSON Parser

- [x] Create `src/server/runner/piJsonEvents.ts` with an incremental JSONL parser that tolerates chunk boundaries and ignores invalid/empty lines.
- [x] Parse Pi `session`, `agent_start`, `turn_start`, `turn_end`, and `agent_end` events into useful normalized lifecycle/final rows.
- [x] Parse Pi `message_update` text deltas without flooding the transcript with every tiny token.
- [x] Parse Pi `message_end` or `turn_end` assistant messages into one final assistant message.
- [x] Parse Pi `tool_execution_start`, `tool_execution_update`, and `tool_execution_end` into normalized command/tool rows.
- [x] Parse Pi tool result errors into warning/error rows with concise messages.
- [x] Parse Pi compaction and retry events into concise warning/agent rows.
- [x] Extract changed file paths from Pi edit/write/tool events when available.
- [x] Add parser tests for message deltas, final messages, tool execution, errors, compaction, retry, and changed-file extraction.

### Phase 9: Wire Pi Runner

- [x] Update `piRunner` to spawn JSON mode by default.
- [x] Feed Pi stdout to raw logs and the Pi JSON parser; emit parsed run events and metadata through existing hooks.
- [x] Keep stderr visible as raw/process logs and warnings/errors where appropriate.
- [x] Ensure `complete()` flushes parser remainder and returns the final assistant message captured from stream state.
- [x] Add run controller tests proving Pi emits live run events before process close.
- [x] Add fallback behavior for missing/unsupported JSON mode only if a concrete runtime failure mode is observed or documented.

### Phase 10: Non-Interactive Provider Guidance

- [ ] Add a compact notice near the provider selector explaining that provider runs are non-interactive and users must configure approvals, trust, sandboxing, and credentials before starting the loop.

### Phase 11: Transcript UX and Duplicate Control

- [ ] Confirm structured JSONL stdout from Codex, Claude, and Pi is hidden from the visible transcript and retained in Raw Logs.
- [ ] Confirm human-readable stderr remains visible in the transcript.
- [ ] Confirm hybrid assistant text behavior: live tool/command/file/status rows appear, streamed text deltas do not create dozens of noisy rows, and final assistant output appears once.
- [ ] Confirm final assistant output appears once.
- [ ] Confirm run completion appears once.
- [ ] Confirm the active running indicator remains visible during long quiet periods.
- [ ] Add or update web tests for all duplicate-suppression and active-running cases.

### Phase 12: End-to-End Behavior

- [ ] Run a mocked Codex JSONL stream through the server and verify SSE emits raw logs, run events, run details, and transcript rows in expected order.
- [ ] Run a mocked Claude JSONL stream through the server and verify SSE emits live activity before process close.
- [ ] Run a mocked Pi JSONL stream through the server and verify SSE emits live activity before process close.
- [ ] If local CLIs and credentials are available, manually run one small real Codex job and inspect the Agent Output panel.
- [ ] If local Claude Code is installed and authenticated, manually run one small real Claude job and inspect the Agent Output panel.
- [ ] If local Pi is installed and authenticated, manually run one small real Pi job and inspect the Agent Output panel.

### Phase 13: Final Cleanup and Verification

- [ ] Remove obsolete print-only assumptions from comments, names, and tests while preserving intentional fallback code.
- [ ] Ensure provider-specific parser code is documented only where event-shape handling is non-obvious.
- [ ] Run focused parser, runner, SSE, and transcript tests.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Add `GOAL_COMPLETE` only after every required checkbox is complete and final verification passes.

## Verification

Use the narrowest verification that proves the selected checkbox.

Expected commands:

- `npm run typecheck`
- `npm test` or the closest focused test command
- `npm run lint`
- `npm run build`

Do not mark a checkbox complete if the changed path has active test failures, type errors, lint errors, build failures, runtime exceptions, broken SSE payloads, duplicate transcript rows, or relevant console errors.

Run broader verification at phase boundaries and before `GOAL_COMPLETE`.

## Blocked / Complete Policy

- Report blocked runs as `GOAL_BLOCKED` with the exact reason.
- Do not persist `GOAL_BLOCKED` in this file unless the user explicitly asks.
- Add `GOAL_COMPLETE` only when every required checkbox is complete and final verification passes.
- Do not add completion markers during ordinary intermediate runs.

## Durable Notes

- Hidden chain-of-thought is out of scope; show only public provider stream events and explicit reasoning summaries if a provider emits them.
- Codex currently supports `codex exec --json` and `--output-last-message`; keep this path working.
- Phase 1 captured Codex CLI `codex-cli 0.139.0`; `codex exec --version` reports `codex-cli-exec 0.139.0`.
- Phase 1 captured `codex exec --help`: `--json` prints JSONL events to stdout and `--output-last-message <FILE>` writes the last agent message.
- Claude Code was not installed on PATH during Phase 1. Official docs document `claude -p "<prompt>" --output-format stream-json --verbose --include-partial-messages` for streaming JSONL token/tool events.
- Claude Code docs list stream output message types including `system/init`, `system/api_retry`, `stream_event`, final assistant/result messages, and raw API events such as `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, and `message_stop`.
- Pi installed package `@earendil-works/pi-coding-agent@0.79.3` documents `pi --mode json` JSONL events in `docs/json.md`; Phase 1 captured installed `pi --version` as `0.79.3`.
- Phase 1 captured `pi --help`: `--mode json` is available for JSONL event output; `--model <pattern>` is available; `--approve` and `--no-approve` are explicit trust flags and should remain omitted by default.
- Pi JSON docs list events including `session`, `agent_start`, `turn_start`, `message_update`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`, `turn_end`, and `agent_end`.
- Pi project trust behavior should be preserved by default; do not pass `--approve` or `--no-approve` automatically.
- Phase 1 fixture notes and available sample JSONL shapes live at `tests/server/runner/fixtures/provider-stream-contracts.md`.
- Phase 2 audit: existing `command_started`, `command_succeeded`, `command_failed`, `file_changed`, `patch_applied`, `warning`, `error`, `final_assistant_message`, and `run_completed` cover shell command lifecycle, file/patch changes, warning/error counts, final assistant text, stop reason, and completion.
- Phase 2 added provider-agnostic `agent_session_started`, `tool_started`, `tool_succeeded`, and `tool_failed`; `toolName` labels provider tools while `files`, `stopReason`, and message handling reuse the existing SSE/transcript pipeline.
- Provider runs use non-interactive/headless modes. The app streams public output but does not answer provider prompts during an active run; users must configure provider approvals, trust, sandboxing, and credentials before starting a loop.
- Pi JSON mode has no documented active approval response channel. Pi project trust is separate from runtime work; non-interactive Pi runs follow saved decisions or `defaultProjectTrust`, and `--approve`/`--no-approve` remain explicit one-run overrides that this app should not add automatically.
- MVP assistant text behavior is hybrid: live activity rows plus one final assistant message, not token-by-token transcript rows.
- Prefer streaming JSON over PTY scraping. Use PTY only if documented JSON modes are unavailable or unusable after explicit user approval.
