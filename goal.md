# Local Model Support via Pi Headless

## Goal

Add a "Pi" provider option so users can run local models (LM Studio, Ollama, vLLM) through Pi's headless print mode (`pi -p`). The user configures their local model server in `~/.pi/agent/models.json`; the goal runner UI exposes Pi as a selectable provider alongside Codex and Claude.

MVP: Pi provider spawns `pi -p <prompt>` (optionally `--model <id>`), captures stdout as the final response, and streams stderr for logging. Model selection is free-text because the available models depend on the user's local `models.json`.

## Scope

### In Scope

- New `pi` provider in the shared `agentProviders` contract
- `piCommand.ts` — builds `pi -p` spawn command with optional `--model`
- `piRunner` in `agentRunner.ts` — spawns Pi print mode, captures stdout as final message
- UI: "Pi" option in provider combobox; free-text model input when Pi is selected
- API: `piModel` field in run start request (nullable string, not an enum)
- Run controller: Pi settings in `AgentRunSettings` union and `StartRunOptions`
- Tests: mirror `claudeCommand.test.ts` pattern for Pi command; update run controller and route tests

### Out of Scope

- Pi JSON mode (`--mode json`) event parsing
- Auto-discovering models from `~/.pi/agent/models.json`
- Pi-specific reasoning effort or thinking controls
- Skill preflight for Pi
- Pi-specific review behavior beyond the shared provider/model wiring

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
- Do not rename public APIs, routes, or exported functions unless explicitly required by the selected item.

## Implementation Plan

### Phase 1: Server — provider contract and command

- [x] Add `"pi"` to `AGENT_PROVIDERS` in `src/server/runner/agentProviders.ts`; update `getAgentProviderLabel` / `getAgentRunLabel`
- [x] Create `src/server/runner/piCommand.ts` — `getPiPrintSpawnCommand(prompt, { model })` returning `SpawnCommand` for `pi -p <prompt>` with optional `--model`
- [x] Export `getPiPrintSpawnCommand` from `src/server/index.ts`
- [x] Add `piModel: string | null` to `AgentRunSettings` union variant in `src/server/runner/agentRunner.ts`
- [x] Add `piRunner` constant in `agentRunner.ts` (print-mode pattern matching `claudeRunner`; stdout accumulated, emitted as `finalAssistantMessage`)
- [x] Wire `piRunner` into `getAgentRunner()` discriminator

### Phase 2: Server — run controller and API routes

- [x] Add `piModel: string | null` to `StartRunOptions` and `ReviewRunOptions` in `runController.ts`
- [x] Update `createAgentRunSettings` / `createReviewAgentRunSettings` to handle `provider === "pi"`
- [x] Update `getAgentRunDetails` / `getReviewRunDetails` for Pi
- [x] Update `formatAgentSpawnError` / `formatReviewSpawnError` with Pi-specific ENOENT message
- [x] Add `piModel` field to `runStartSchema` in `runRoutes.ts` (nullable string, not enum)
- [x] Add `piModel` field to enabled review request schema and accepted response shape
- [x] Add Pi-specific validation in `addProviderSettingIssues` (piModel only valid when provider is "pi"; codex/claude fields invalid when provider is "pi")
- [x] Update `DEFAULT_REVIEW_RUN_OPTIONS` to include `piModel: null`

### Phase 3: Web — shared contract and UI

- [x] Add `"pi"` to `AGENT_PROVIDERS` in `src/web/runner/agentProviders.ts`
- [x] Add `PiModelSelection` type and `PI_MODEL_INPUT_PLACEHOLDER` in `src/web/runner/codexOptions.ts` (or new `piOptions.ts`)
- [x] Add `piModel` state to `ControlsPanel` component
- [x] Show free-text `<Input>` for Pi model when provider is "pi" (replaces model combobox)
- [x] Add `piModel` to `controlsPanelReview.ts` request shaping and the review settings form when review provider is "pi"
- [x] Send `piModel` in `handleRunStart` request body (only when provider is "pi")
- [x] Update `RunStartResponse` type in `src/web/api/responses.ts` to include top-level and review `piModel`

### Phase 4: Tests

- [x] Create `tests/server/runner/piCommand.test.ts` — mirrors `claudeCommand.test.ts` pattern (prompt, optional model, platform resolution)
- [x] Update `tests/server/runner/runController.test.ts` — Pi provider spawn and close scenarios
- [x] Update `tests/server/routes/runRoutes.test.ts` — Pi provider validation (valid piModel, cross-provider rejection)
- [x] Update `tests/web/runner/statuses.test.ts` or add `tests/web/runner/agentProviders.test.ts` if provider list tests exist

### Phase 5: Final verification

- [x] Run `npm run typecheck`, `npm test`, `npm run lint`, `npm run build` — all pass

## Verification

Use the narrowest verification that proves the selected checkbox.

Expected commands:

- `npm run typecheck`
- `npm test` or the closest focused test command
- `npm run lint`
- `npm run build`

Do not mark a checkbox complete if the changed path has active test failures, type errors, lint errors, build failures, runtime exceptions, or relevant console errors.

Run broader verification at phase boundaries or before `GOAL_COMPLETE`.

## Blocked / Complete Policy

- Report blocked runs as `GOAL_BLOCKED` with the exact reason.
- Do not persist `GOAL_BLOCKED` in this file unless the user explicitly asks.
- Add `GOAL_COMPLETE` only when every required checkbox is complete and final verification passes.
- Do not add completion markers during ordinary intermediate runs.

GOAL_COMPLETE

## Durable Notes

- Pi print mode (`pi -p`) is the MVP; JSON mode is deferred.
- Pi model is free-text (user's `~/.pi/agent/models.json` is the source of truth for available models).
- Pi does not have a reasoning effort concept in this phase; that field is Codex-only.
