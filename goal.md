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
- Add an approval path for Pi runtime requests that require user confirmation, including install/download/web-fetch actions when Pi emits an approval event or blocks for approval.
- Add a pre-run approval policy setting for provider approval requests: Ask every time, Always approve for this run, or Always deny for this run.
- Use a hybrid assistant-text MVP: show live tool/command/file/status activity, avoid token-by-token transcript spam, and render final assistant output once.
- Add tests for command construction, parser behavior, run controller wiring, SSE payloads, and visible transcript behavior.

### Out of Scope

- Displaying hidden chain-of-thought, private reasoning tokens, or simulated internal thinking.
- Building a PTY scraper for interactive TUIs unless streaming JSON is proven unusable.
- Implementing Pi RPC mode as the default path; a narrow RPC adapter is allowed only if JSON mode cannot answer runtime approval requests.
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
- Approval UX: when a provider requests confirmation, show a clear pending approval state with Approve, Deny, Always approve for this run, and Always deny for this run actions when supported by the provider.
- Pre-run approval UX: Run setup includes an approval policy control with Ask every time as the default; Always approve and Always deny apply only to provider approval requests in that run.

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
- Do not auto-approve Pi project trust, package installs, downloads, web access, or other provider approval requests.
- Before running install/download commands, request approval and state what will be installed.

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
- `src/web/components/app/ControlsPanel.tsx`: pre-run approval policy control.
- `src/server/routes/runRoutes.ts`: run start approval policy validation and response shape.
- `tests/server/runner/*`: command builder and parser tests.
- `tests/server/routes/runRoutes.test.ts` and `tests/server/runner/runController.test.ts`: provider wiring and SSE behavior tests.
- `tests/web/events/runtimeStream.test.ts` and component tests: transcript behavior tests.

## Implementation Plan

### Phase 1: Confirm Provider Stream Contracts

- [ ] Capture the installed Codex CLI version and `codex exec --help` options relevant to `--json` and `--output-last-message`.
- [ ] Capture Claude Code streaming options from official docs or installed `claude --help`; record the exact flags needed for JSON streaming in Durable Notes.
- [ ] Capture Pi JSON mode options from installed docs or `pi --help`; record the exact flags needed for JSON streaming in Durable Notes.
- [ ] Add small parser fixture notes or sample JSONL snippets for Codex, Claude, and Pi under tests if real samples are available without credentials.

### Phase 2: Normalize Public Activity Events

- [ ] Audit current `RunEventKind` values and list which existing kinds can represent command/tool starts, command/tool completions, file changes, warnings, errors, final assistant messages, and run completion.
- [ ] Add only the minimal new `RunEventKind` values needed for provider-agnostic live activity that cannot be represented today.
- [ ] Update `RunEventPayload`, SSE serialization, run details aggregation, and transcript kind mapping for any new event kinds.
- [ ] Add tests proving old event kinds and any new event kinds update changed files, warning/error counts, stop reason, and last assistant message correctly.

### Phase 3: Codex Parser Polish

- [ ] Review `CodexJsonEventParser` against current Codex JSONL samples and identify any public activity currently ignored that should appear in the transcript.
- [ ] Extend Codex parsing only for concrete observed fields or documented event shapes.
- [ ] Preserve filtering of raw structured Codex JSONL from the visible transcript while keeping it in Raw Logs.
- [ ] Add focused Codex parser tests for any newly supported event shapes.

### Phase 4: Claude Streaming JSON Command

- [ ] Add a Claude command builder path for streaming JSON output using the documented `claude -p --output-format stream-json --verbose` style flags.
- [ ] Preserve model selection behavior for Claude.
- [ ] Keep a clearly named print-mode builder only if tests or fallback behavior still require it.
- [ ] Update Claude command tests to cover streaming JSON arguments and existing Windows package-bin resolution.

### Phase 5: Claude Streaming JSON Parser

- [ ] Create `src/server/runner/claudeJsonEvents.ts` with an incremental JSONL parser that tolerates chunk boundaries and ignores invalid/empty lines.
- [ ] Parse Claude session/system lifecycle events into normalized run events where useful.
- [ ] Parse Claude assistant text/final result events into a single final assistant message without duplicating streamed deltas.
- [ ] Parse Claude tool/command start events into normalized command/tool start rows with useful labels.
- [ ] Parse Claude tool/command result events into success/failure rows, including stderr/error text when available.
- [ ] Parse Claude file edit indicators into changed-file or patch-applied rows only when file paths are available.
- [ ] Extract model, stop reason, and token usage metadata when emitted.
- [ ] Add parser tests using representative JSONL objects for text, tool use, tool result, failure, and metadata.

### Phase 6: Wire Claude Runner

- [ ] Update `claudeRunner` to spawn the streaming JSON command by default.
- [ ] Feed Claude stdout to raw logs and the Claude JSON parser; emit parsed run events and metadata through existing hooks.
- [ ] Keep stderr visible as raw/process logs and warnings/errors where appropriate.
- [ ] Ensure `complete()` flushes parser remainder and returns the final assistant message captured from stream state.
- [ ] Add run controller tests proving Claude emits live run events before process close.
- [ ] Add fallback behavior for missing/unsupported streaming JSON only if a concrete runtime failure mode is observed or documented.

### Phase 7: Pi JSON Command

- [ ] Add a Pi command builder path for `pi --mode json <prompt>`.
- [ ] Preserve optional `--model <id>` behavior for Pi.
- [ ] Preserve Pi's current project trust behavior; do not pass `--approve` or `--no-approve` by default.
- [ ] Keep a clearly named print-mode builder only if tests or fallback behavior still require it.
- [ ] Update Pi command tests to cover JSON mode arguments, optional model, and existing Windows package-bin resolution.

### Phase 8: Pi JSON Parser

- [ ] Create `src/server/runner/piJsonEvents.ts` with an incremental JSONL parser that tolerates chunk boundaries and ignores invalid/empty lines.
- [ ] Parse Pi `session`, `agent_start`, `turn_start`, `turn_end`, and `agent_end` events into useful normalized lifecycle/final rows.
- [ ] Parse Pi `message_update` text deltas without flooding the transcript with every tiny token.
- [ ] Parse Pi `message_end` or `turn_end` assistant messages into one final assistant message.
- [ ] Parse Pi `tool_execution_start`, `tool_execution_update`, and `tool_execution_end` into normalized command/tool rows.
- [ ] Parse Pi tool result errors into warning/error rows with concise messages.
- [ ] Parse Pi compaction and retry events into concise warning/agent rows.
- [ ] Extract changed file paths from Pi edit/write/tool events when available.
- [ ] Add parser tests for message deltas, final messages, tool execution, errors, compaction, retry, and changed-file extraction.

### Phase 9: Wire Pi Runner

- [ ] Update `piRunner` to spawn JSON mode by default.
- [ ] Feed Pi stdout to raw logs and the Pi JSON parser; emit parsed run events and metadata through existing hooks.
- [ ] Keep stderr visible as raw/process logs and warnings/errors where appropriate.
- [ ] Ensure `complete()` flushes parser remainder and returns the final assistant message captured from stream state.
- [ ] Add run controller tests proving Pi emits live run events before process close.
- [ ] Add fallback behavior for missing/unsupported JSON mode only if a concrete runtime failure mode is observed or documented.

### Phase 10: Provider Approval Requests

- [ ] Research Pi JSON/RPC event shapes for approval requests, especially install/download/web access prompts.
- [ ] Prove whether `pi --mode json` can receive approval decisions while a run is active; if it cannot, document the limitation in Durable Notes before adding any RPC fallback.
- [ ] If Pi JSON mode cannot receive approval decisions, add the smallest Pi RPC adapter needed for prompt submission, event streaming, and approval responses.
- [ ] Add shared request/response contract for a provider approval policy with allowed values `ask`, `alwaysApprove`, and `alwaysDeny`.
- [ ] Add Run setup UI control for the provider approval policy, defaulting to Ask every time.
- [ ] Send the selected provider approval policy in run start requests and preserve it in active run state.
- [ ] Add normalized server state for a pending provider approval request with provider, run id, message, requested action, and available choices.
- [ ] Broadcast pending approval state over SSE and include it in initial SSE snapshots for reconnects.
- [ ] Add backend route(s) to approve, deny, always approve for this run, and always deny for this run when the active provider supports those actions.
- [ ] Apply the pre-run policy before surfacing a pending request: ask shows UI, always approve submits approval, and always deny submits denial.
- [ ] Ensure approval choices are scoped to the active run and cleared on run completion, failure, stop, or provider process exit.
- [ ] Add UI controls in Agent Output for pending approvals without blocking log streaming.
- [ ] Add tests for approval policy request validation, SSE snapshots, approval route validation, run-scoped always approve/deny behavior, pre-run policy behavior, and cleanup after process close.
- [ ] Add tests proving review runs either use the same approval handling or explicitly reject unsupported provider approval prompts with a clear error.

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
- [ ] Run a mocked Pi approval request through the server and verify the UI can approve and deny it.
- [ ] Run a mocked pre-run always approve policy through the server and verify the approval UI is skipped.
- [ ] Run a mocked pre-run always deny policy through the server and verify the approval UI is skipped.
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
- Claude Code streaming target is documented as `claude -p --output-format stream-json --verbose`; verify exact installed CLI behavior before wiring.
- Pi installed package `@earendil-works/pi-coding-agent@0.79.3` documents `pi --mode json` JSONL events in `docs/json.md`; verify exact installed CLI behavior before wiring.
- Pi JSON docs list events including `session`, `agent_start`, `turn_start`, `message_update`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`, `turn_end`, and `agent_end`.
- Pi project trust behavior should be preserved by default; do not pass `--approve` or `--no-approve` automatically.
- Pi install/download/web approvals need explicit user controls: Approve, Deny, Always approve for this run, and Always deny for this run when supported by the provider.
- Run setup should also allow choosing Ask every time, Always approve for this run, or Always deny for this run before the run starts; default is Ask every time.
- Verify whether Pi JSON mode is bidirectional enough for approvals. Use Pi RPC only if JSON mode cannot submit approval decisions during an active run.
- MVP assistant text behavior is hybrid: live activity rows plus one final assistant message, not token-by-token transcript rows.
- Prefer streaming JSON over PTY scraping. Use PTY only if documented JSON modes are unavailable or unusable after explicit user approval.
