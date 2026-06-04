# codex-goal-runner Goal

## Product Goal

Build a lightweight local developer tool named `codex-goal-runner`.

The app provides a browser-based operations panel backed by a local Node.js server. It repeatedly runs the user's existing Codex CLI against a selected repository's repo-local `goal.md`, then refreshes the rendered goal document, live logs, and run status after each pass.

The MVP should let the user select a local repository, view or create its `goal.md`, configure a repeat prompt and run count, run `codex exec <prompt>` in a controlled loop, optionally verify and commit after successful runs, and stop safely when a stop condition is reached.

## Durable Control File Rule

- `goal.md` is the only supported durable goal/control file.
- The app must not support `refactor.md`, `migration.md`, alternate plan files, arbitrary markdown files, or a file tree.
- This repository's `goal.md` controls implementation work on `codex-goal-runner`.
- A selected target repository's `<selected-repo>/goal.md` is runtime user data that the app reads, renders, watches, and makes available to Codex by running Codex in that repository.
- The app may create a default `goal.md` in the selected target repository only when the user explicitly requests creation.
- The app should read and render only `<selected-repo>/goal.md`.
- The app process itself should not directly edit a selected repository's `goal.md` except when creating the default file.
- Codex runs launched in a selected repository may edit that repository's `goal.md` according to that repository's own instructions and the user's run prompt.

## Scope

### In Scope

- Local Node.js backend using Fastify and TypeScript.
- Vite, React, and TypeScript frontend.
- Tailwind CSS and focused shadcn/ui components for a compact operations-panel UI.
- `marked` plus DOMPurify for sanitized markdown rendering.
- Server-Sent Events for backend-to-frontend status and log streaming.
- `chokidar` for watching the selected repository's `goal.md`.
- `zod` for request and input validation.
- `child_process.spawn()` for Codex, git, and optional verification commands.
- Calling Codex as `codex exec <prompt>`.
- Relying on the user's existing `codex` CLI installation and authentication.
- In-memory runtime state only.
- Optional verification after successful Codex runs.
- Optional auto-commit after Codex and verification succeed.

### Out of Scope

- Electron or Tauri.
- Database persistence or run history across server restarts.
- Model provider configuration.
- OpenAI API keys or any API-key entry flow.
- Code editor, file tree, or diff viewer.
- Plugin system.
- Multi-goal workflows.
- Support for any durable plan file other than `goal.md`.
- Remote repository browsing or hosted execution.
- Telemetry or remote log upload.

## Stop Conditions

The run loop must stop when any of these occurs:

- Codex exits with a non-zero status.
- The user presses stop.
- The configured maximum run count is reached.
- The refreshed `goal.md` contains `GOAL_COMPLETE`.
- The refreshed `goal.md` contains `GOAL_BLOCKED`.
- Optional verification fails.
- Auto-commit is enabled and git commit fails.
- Required inputs are invalid or missing.
- The selected repository or `goal.md` becomes unavailable during a run.

## Product Shape

The app should feel like a small professional operations panel: focused, quiet, compact, and useful during repeated local development runs.

- Top bar: app name, selected repository path, and current status badge.
- Main left panel: rendered sanitized `goal.md`.
- Right side panel: repository selection, repeat prompt, run count, optional verification command, auto-commit toggle, start button, and stop button.
- Bottom panel: live logs and latest run summary.
- Use shadcn/ui controls where useful, but do not add unused component scaffolding.

## Safety Rules

- Never ask for, store, or expose OpenAI API keys or model-provider credentials.
- Never run Codex, git, or verification commands outside the selected repository working directory.
- Validate repository paths, request bodies, run configuration, and goal-creation requests before using them.
- Resolve and normalize paths before file access, and reject attempts to read outside the selected repository's `goal.md`.
- Use `spawn()` argument arrays rather than shell-concatenated command strings wherever practical.
- For MVP verification commands, prefer a single executable plus arguments; reject shell operators unless compound shell execution is explicitly approved.
- Do not auto-commit unless the user explicitly enables it for the current run configuration.
- Do not run more than the requested number of Codex passes.
- Do not continue after any stop condition.
- Keep logs local. Do not add telemetry, analytics, or remote log upload.
- Do not add new dependencies unless they are directly needed for the selected checkbox.

## Future Codex Run Discipline

Future Codex runs working from this file must complete exactly one unchecked checkbox or one unchecked sub-checkbox at a time.

Rules for future runs:

- Use this `goal.md` as the source of truth.
- Pick the first sensible unchecked item that can be completed independently.
- Split oversized checklist items before implementing them.
- Do not complete multiple checklist items in one run unless one item is only a tiny parent for already-completed substeps.
- Future implementation runs may create, edit, or delete project files as needed to complete the selected checkbox or sub-checkbox.
- When editing this file after implementation, update only the relevant checkbox state and any short durable blocker or decision that future runs need. This restriction applies only to edits made inside `goal.md`.
- At the end of every phase, update `README.md` to reflect the completed behavior, commands, and usage before considering the phase complete.
- Do not mark a checkbox complete unless the required files or behavior were implemented and verified.
- Do not finish or mark work complete while active bugs, failing diagnostics, failing tests, build failures, runtime exceptions, or relevant console errors remain in the changed code path.
- Do not scaffold ahead of the selected checkbox.
- Do not broaden scope beyond the selected checkbox or sub-checkbox.
- Do not add support for plan files other than `goal.md`.
- If blocked, clearly say `GOAL_BLOCKED` in the Codex response with the exact reason.
- Do not add a persistent `GOAL_BLOCKED` marker to this file unless the user explicitly asks for persistent blocked status.
- Mark `GOAL_COMPLETE` only when every required MVP checkbox is complete and final verification passes.

## File Hygiene Rules

- Keep this file as a concise execution control document, not an implementation journal.
- Do not add progress summaries, reasoning traces, routine observations, or command output.
- Only edit this file to:
  - check off verified completed items,
  - split oversized items into smaller actionable unchecked steps,
  - add newly discovered required work or durable blockers,
  - remove or retire work only after verifying it is no longer needed,
  - record user approvals or decisions that materially affect future runs.
- Keep durable notes short.
- If a note will not matter to a future run, do not write it here.

## Definition of Done

A checklist item is complete only when:

- the relevant code or documentation has been implemented,
- existing behavior and contracts have been preserved unless the checkbox requires changing them,
- active bugs in the touched code path have been investigated and fixed or explicitly classified as pre-existing blockers,
- the most focused practical verification has passed,
- broader verification has been run when the change affects shared behavior or the main workflow,
- visible UI changes have been manually checked in a browser when practical,
- diagnostics, test failures, build failures, runtime errors, console errors, and lint/type errors introduced or exposed by the change are resolved,
- the relevant checkbox has been checked off in this file.

For API, process, and filesystem behavior:

- Do not rename scripts, endpoints, event names, request fields, response fields, or persisted assumptions unless the selected checkbox requires it.
- Do not combine unrelated behavior changes in one pass.
- Add or update tests when stop conditions, path restrictions, validation, process spawning, or state transitions change.

## Required First Pass

Before implementation, Codex must:

- Inspect the relevant project structure.
- Identify existing conventions, dependencies, tests, scripts, and verification commands.
- Identify currently visible bugs or diagnostics related to the selected work before editing code.
- Confirm whether the next checklist item is stale, incomplete, or too broad.
- Split oversized checklist items before implementation.
- Avoid adding reconnaissance notes unless they record a blocker, user approval, or durable decision.

## Implementation Phases

### Phase 1: Project Foundation

- [x] Create the minimal project scaffold.
  - [x] Add `package.json` with development, typecheck, lint, test, and production build scripts.
  - [x] Add TypeScript configuration for backend and frontend.
  - [x] Add the minimal Fastify server entrypoint.
  - [x] Add the minimal Vite + React entrypoint.
  - [x] Add Tailwind configuration and the frontend stylesheet entry.
  - [x] Add only the UI primitives needed by the first screen.
  - [x] Add a short README with local development and verification commands.
- [x] Update README.md with the completed Phase 1 behavior, commands, and usage.

### Phase 2: Backend Repository and Goal File API

- [x] Add repository selection endpoint with `zod` validation for a local path.
- [x] Validate selected paths as existing directories and git repositories.
- [x] Store the selected repository only in local in-memory runtime state.
- [x] Add `goal.md` read endpoint restricted to `<selected-repo>/goal.md`.
- [x] Return a clear missing-goal state when `goal.md` does not exist.
- [x] Add explicit user-requested default `goal.md` creation.
- [x] Refuse arbitrary markdown paths and alternate plan names.
- [x] Return useful validation errors to the frontend.
- [x] Update README.md with the completed Phase 2 behavior, commands, and usage.

### Phase 3: Backend Streaming and File Watching

- [x] Add Server-Sent Events for status, logs, run progress, and latest summary.
- [x] Start a `chokidar` watcher when a repository is selected.
- [x] Stop or replace the watcher when the selected repository changes.
- [x] Notify connected clients when `goal.md` changes.
- [x] Avoid watching unrelated files.
- [x] Update README.md with the completed Phase 3 behavior, commands, and usage.

### Phase 4: Codex Run Loop

- [x] Add run-loop state for idle, running, stopping, complete, blocked, failed, and stopped.
- [x] Add start validation for selected repo, prompt, run count, and no active run.
- [x] Spawn a fresh `codex exec <prompt>` process for each run in the selected repository.
- [x] Stream Codex stdout and stderr to connected clients.
- [x] Stop immediately on non-zero Codex exit.
- [x] Re-read `goal.md` after each successful Codex run.
- [x] Stop when refreshed `goal.md` contains `GOAL_COMPLETE` or `GOAL_BLOCKED`.
- [x] Continue only when no stop condition is present and runs remain.
- [x] Add stop endpoint that terminates the active child process when possible.
- [x] Prevent new runs from starting after stop is requested.
- [x] Report stopped status clearly.
- [x] Update README.md with the completed Phase 4 behavior, commands, and usage.

### Phase 5: Optional Verification and Auto-Commit

- [x] Accept an empty verification value or a single command with arguments.
- [x] Validate or parse verification before spawning it.
- [x] Run verification only after a successful Codex run in the selected repository.
- [ ] Stream verification output and stop on verification failure.
- [ ] Add explicit auto-commit toggle.
- [ ] Commit only after Codex and optional verification succeed.
- [ ] Run git status before commit and skip commit when there are no changes.
- [ ] Use a clear generated commit message, stream git output, and stop on commit failure.
- [ ] Update README.md with the completed Phase 5 behavior, commands, and usage.

### Phase 6: Frontend Shell and Layout

- [ ] Add top bar with app name, selected repository path, and status badge.
- [ ] Add main left panel for rendered `goal.md`.
- [ ] Add compact right-side controls panel.
- [ ] Add bottom logs and latest summary panel.
- [ ] Keep the UI responsive without changing the primary workflow.
- [ ] Add repository path entry, selected-path display, and validation errors.
- [ ] Show a create-default-`goal.md` action when missing.
- [ ] Update README.md with the completed Phase 6 behavior, commands, and usage.

### Phase 7: Markdown Rendering

- [ ] Fetch `goal.md` from the backend.
- [ ] Convert markdown with `marked`.
- [ ] Sanitize rendered HTML with DOMPurify.
- [ ] Style markdown output for readability.
- [ ] Refresh rendering when the backend reports a file change or completed run.
- [ ] Update README.md with the completed Phase 7 behavior, commands, and usage.

### Phase 8: Run Controls and Live Status

- [ ] Add repeat prompt textarea.
- [ ] Add run count input.
- [ ] Add optional verification command input.
- [ ] Add auto-commit switch.
- [ ] Add start and stop buttons with correct disabled states.
- [ ] Connect to the SSE stream.
- [ ] Show status, run progress, logs, and latest run summary.
- [ ] Update README.md with the completed Phase 8 behavior, commands, and usage.

### Phase 9: Verification and Polish

- [ ] Add unit tests for stop-condition detection.
- [ ] Add unit tests for request validation.
- [ ] Add unit tests for `goal.md` path restrictions.
- [ ] Add unit tests for run-loop state transitions.
- [ ] Manually verify repository selection, goal creation, and goal rendering.
- [ ] Manually verify a one-run Codex loop with a harmless prompt.
- [ ] Manually verify stop conditions: max run count, `GOAL_COMPLETE`, `GOAL_BLOCKED`, user stop, verification failure, and auto-commit failure.
- [ ] Update README.md with the completed Phase 9 behavior, commands, usage, and final verification status.

## Verification Guidance

Use the repo's actual scripts:

- `npm run typecheck`
- `npm test` or the closest available focused test command
- `npm run build`
- Manual browser verification of the main workflow when UI or run-loop behavior changes

Active bug gate:

- Before finishing, rerun the most relevant diagnostics for the changed code path.
- Treat any active bug, failing diagnostic, failing test, build failure, runtime exception, or obvious console error in the changed path as a blocker.
- Do not mark work complete while active bugs remain unless the bug is clearly unrelated pre-existing behavior; in that case, document it as `GOAL_BLOCKED` or add a durable blocker rather than silently finishing.

For small documentation-only changes, no code verification is required, but the markdown should still be reviewed for consistency.

Do not mark a checkbox complete unless its behavior has been implemented and verified.

## Blocked Status Handling

- Codex should report blocked runs in its response as `GOAL_BLOCKED` with the exact reason.
- Codex should not persist `GOAL_BLOCKED` into this file by default.
- The app may stop when a refreshed selected repository `goal.md` contains `GOAL_BLOCKED`.
- A persistent `GOAL_BLOCKED` marker may be added to this file only when the user explicitly asks for persistent blocked status.

## Completion Markers

Add exactly one of these markers only when appropriate:

- `GOAL_COMPLETE` when every required MVP checkbox is complete and final verification passes.
- `GOAL_BLOCKED` only when the user explicitly asks Codex to persist blocked status in this file.
