# codex-goal-runner Goal

## Product Goal

Build a lightweight local developer tool named `codex-goal-runner`.

The app provides a browser-based operations panel backed by a local Node.js server. It repeatedly runs the user's existing Codex CLI against a selected repository's repo-local `goal.md` file, refreshing the rendered goal document and live run status after each run.

The MVP should make it easy to select a local repository, view its `goal.md`, configure a repeat prompt and run count, run `codex exec <prompt>` in a controlled loop, observe logs, and stop safely when the goal is complete, blocked, failed, stopped by the user, or the requested run count is reached.

## Durable Control File Rule

- `goal.md` is the only supported durable goal/control file.
- The app must not support `refactor.md`, `migration.md`, alternate plan files, arbitrary markdown files, or a file tree.
- The app may create a default `goal.md` in the selected target repository if one does not exist.
- The app should read and render only the selected repository's `goal.md`.
- The app should not edit `goal.md` directly except when creating the default file.

## MVP Scope

### In Scope

- Node.js backend using Fastify and TypeScript.
- Vite + React + TypeScript frontend.
- Tailwind CSS and shadcn/ui for a clean, compact operations-panel UI.
- `marked` plus DOMPurify for sanitized markdown rendering.
- Server-Sent Events for backend-to-frontend status and log streaming.
- `chokidar` for watching the selected repository's `goal.md`.
- `zod` for request and input validation.
- `child_process.spawn()` for Codex, git, npm, or other verification commands.
- Calling Codex as `codex exec <prompt>`.
- Relying on the user's existing `codex` CLI installation and authentication.
- No database or persistent server-side state beyond the selected runtime session.
- Optional verification commands after successful Codex runs.
- Optional auto-commit after each successful run.

### Out of Scope

- Electron.
- Tauri.
- Database persistence.
- Model provider configuration.
- OpenAI API keys or any API-key entry flow.
- Code editor.
- File tree.
- Diff viewer.
- Plugin system.
- Multi-goal workflows.
- Support for any durable plan file other than `goal.md`.
- Remote repository browsing or hosted execution.

## Product Shape

The app should feel like a small professional operations panel: focused, quiet, and useful during repeated local development runs.

Suggested layout:

- Top bar: app name, selected repository path, current status badge.
- Main left panel: rendered `goal.md` as polished sanitized markdown.
- Right side panel: repeat prompt, run count, verification command, auto-commit toggle, start and stop buttons.
- Bottom panel: live logs and latest run summary.

Use shadcn/ui components where useful:

- `Card`
- `Button`
- `Textarea`
- `Input`
- `Badge`
- `Progress`
- `Switch`
- `ScrollArea`
- `Alert`
- `Separator`

## Stop Conditions

The run loop must stop when any of these occurs:

- Codex exits with a non-zero status.
- The user presses stop.
- The configured maximum run count is reached.
- The refreshed `goal.md` contains `GOAL_COMPLETE`.
- The refreshed `goal.md` contains `GOAL_BLOCKED`.
- An optional verification command fails.
- Auto-commit is enabled and git commit fails.
- Required inputs are invalid or missing.

## Safety Rules

- Never ask for OpenAI API keys.
- Never store model-provider credentials.
- Never run Codex outside the selected repository working directory.
- Validate repository paths and request bodies before spawning commands.
- Use `spawn()` argument arrays, not shell-concatenated command strings, for Codex, git, npm, and verification commands wherever practical.
- Stream process output to the UI without blocking the server.
- Treat user-provided verification commands carefully and document the tradeoff if shell execution is required for compound commands.
- Do not auto-commit unless the user explicitly enables it.
- Do not run more than the requested number of Codex runs.
- Do not continue after a stop condition.
- Keep logs basic and local; do not add telemetry.

## Future Codex Run Discipline

Future Codex runs working from this file must complete exactly one unchecked checkbox or one unchecked sub-checkbox at a time.

Rules for future runs:

- Pick the first sensible unchecked item that can be completed independently.
- Do not complete multiple checklist items in one run unless one item is a tiny parent whose only purpose is grouping already-completed substeps.
- Keep each change independently verifiable.
- Completing an item means implementing the required project files or behavior, verifying the change, and then updating the relevant checkbox state in this `goal.md`.
- Future implementation runs may create, edit, or delete project files as needed to complete the selected checkbox or sub-checkbox.
- When editing `goal.md`, update only the checkbox state for the completed item and avoid rewriting unrelated sections.
- Do not interpret "update only that checkbox" as "only edit `goal.md`"; that restriction applies only to edits made inside `goal.md`.
- Do not mark a checkbox complete unless the required files or behavior were actually created or changed and verified.
- Do not scaffold ahead of the current checkbox.
- Do not broaden scope beyond the selected checkbox or sub-checkbox.
- Do not add support for plan files other than `goal.md`.
- If blocked, clearly say `GOAL_BLOCKED` in the Codex response with the exact reason.
- Do not add a persistent `GOAL_BLOCKED` marker to `goal.md` unless the user explicitly asks for persistent blocked status.
- Mark `GOAL_COMPLETE` only when every MVP checkbox is complete and verification passes.

## Blocked Status Handling

- Codex should report blocked runs in its response as `GOAL_BLOCKED` with the exact reason.
- Codex should not persist `GOAL_BLOCKED` into `goal.md` by default.
- The app may still stop if the refreshed `goal.md` contains `GOAL_BLOCKED`.
- A persistent `GOAL_BLOCKED` marker may be added to `goal.md` only when the user explicitly asks for persistent blocked status.
- `GOAL_COMPLETE` may still be added to `goal.md` when every MVP checkbox is complete and verification passes.

## Implementation Phases

### Phase 1: Project Foundation

- [ ] Create the minimal project scaffold.
  - [x] Add `package.json` with scripts for development, typecheck, lint if configured, tests if configured, and production build.
  - [x] Add TypeScript configuration for backend and frontend.
  - [ ] Add Vite + React + TypeScript frontend structure.
  - [ ] Add Fastify + TypeScript backend structure.
  - [ ] Add Tailwind CSS.
  - [ ] Add shadcn/ui setup and only the components needed for the MVP.
  - [ ] Add a short README with local development commands.

### Phase 2: Backend Repository and Goal File API

- [ ] Implement backend repository selection support.
  - [ ] Accept a local repository path from the frontend.
  - [ ] Validate that the path exists and is a directory.
  - [ ] Validate that the path appears to be a git repository or clearly report that it is not.
  - [ ] Store the selected path only in local in-memory runtime state.

- [ ] Implement `goal.md` read and creation endpoints.
  - [ ] Read only `<selected-repo>/goal.md`.
  - [ ] Return a clear not-found state when `goal.md` does not exist.
  - [ ] Create a default `goal.md` only when the user requests creation.
  - [ ] Refuse to read arbitrary markdown files or alternate plan names.

- [ ] Add input validation.
  - [ ] Use `zod` schemas for repository path, run configuration, and create-goal requests.
  - [ ] Return useful validation errors to the frontend.

### Phase 3: Backend Streaming and File Watching

- [ ] Implement Server-Sent Events.
  - [ ] Stream status changes.
  - [ ] Stream basic logs.
  - [ ] Stream run count and total run count.
  - [ ] Stream latest run summary.

- [ ] Watch `goal.md` with `chokidar`.
  - [ ] Start watching when a repository is selected.
  - [ ] Stop or replace the watcher when the selected repository changes.
  - [ ] Notify connected clients when `goal.md` changes.
  - [ ] Avoid watching unrelated files.

### Phase 4: Codex Run Loop

- [ ] Implement the run-loop backend state machine.
  - [ ] Accept repeat prompt and run count.
  - [ ] Validate that no run is already active before starting.
  - [ ] Track idle, running, stopping, complete, blocked, failed, and stopped states.
  - [ ] Expose current run number, total runs, and status.

- [ ] Spawn Codex runs.
  - [ ] Launch a fresh process for each run.
  - [ ] Call Codex as `codex exec <prompt>`.
  - [ ] Run Codex in the selected repository working directory.
  - [ ] Stream stdout and stderr to the UI.
  - [ ] Stop immediately on non-zero Codex exit.

- [ ] Refresh and inspect `goal.md` after each run.
  - [ ] Re-read `goal.md` after every Codex process exits successfully.
  - [ ] Stop when `GOAL_COMPLETE` appears.
  - [ ] Stop when `GOAL_BLOCKED` appears.
  - [ ] Continue only when no stop condition is present and runs remain.

- [ ] Implement user stop.
  - [ ] Add a stop endpoint.
  - [ ] Terminate the active child process when possible.
  - [ ] Prevent new runs from starting after stop is requested.
  - [ ] Report stopped status clearly.

### Phase 5: Optional Verification and Auto-Commit

- [ ] Add optional verification command support.
  - [ ] Accept a verification command string or empty value.
  - [ ] Run verification only after a successful Codex run.
  - [ ] Run verification in the selected repository working directory.
  - [ ] Stream verification output.
  - [ ] Stop on verification failure.
  - [ ] Document any limitations around compound shell commands.

- [ ] Add optional auto-commit support.
  - [ ] Add an explicit auto-commit toggle.
  - [ ] Commit only after Codex and optional verification succeed.
  - [ ] Run git status before commit and skip commit when there are no changes.
  - [ ] Use a clear generated commit message.
  - [ ] Stream git output.
  - [ ] Stop on git commit failure.

### Phase 6: Frontend Shell and Layout

- [ ] Build the main operations layout.
  - [ ] Add top bar with app name, selected repository path, and status badge.
  - [ ] Add main left panel for rendered `goal.md`.
  - [ ] Add compact right-side controls panel.
  - [ ] Add bottom logs and latest summary panel.
  - [ ] Keep the UI responsive without changing the primary workflow.

- [ ] Implement repository selection UI.
  - [ ] Allow entering a local repository path.
  - [ ] Show selected path clearly.
  - [ ] Show validation errors.
  - [ ] Show a create-default-`goal.md` action when missing.

### Phase 7: Markdown Rendering

- [ ] Render `goal.md` in the browser.
  - [ ] Fetch `goal.md` from the backend.
  - [ ] Convert markdown with `marked`.
  - [ ] Sanitize rendered HTML with DOMPurify.
  - [ ] Style markdown output for readability.
  - [ ] Refresh rendering when the backend reports a file change.
  - [ ] Refresh rendering after every Codex run.

### Phase 8: Run Controls and Live Status

- [ ] Implement run configuration controls.
  - [ ] Add repeat prompt textarea.
  - [ ] Add run count input.
  - [ ] Add optional verification command input.
  - [ ] Add auto-commit switch.
  - [ ] Add start button.
  - [ ] Add stop button.
  - [ ] Disable controls appropriately while running.

- [ ] Implement live status display.
  - [ ] Connect to the SSE stream.
  - [ ] Show current status.
  - [ ] Show current run count and total runs.
  - [ ] Show progress.
  - [ ] Show basic logs in a scrollable panel.
  - [ ] Show latest run summary.

### Phase 9: Verification and Polish

- [ ] Add focused automated checks where practical.
  - [ ] Typecheck backend and frontend.
  - [ ] Add unit tests for stop-condition detection.
  - [ ] Add unit tests for request validation.
  - [ ] Add unit tests for `goal.md` path restrictions.

- [ ] Manually verify the MVP flow.
  - [ ] Start the local backend and frontend.
  - [ ] Select a test repository path.
  - [ ] Create a default `goal.md` when missing.
  - [ ] Render an existing `goal.md`.
  - [ ] Start a one-run Codex loop with a harmless prompt.
  - [ ] Confirm logs stream.
  - [ ] Confirm rendered `goal.md` refreshes after the run.
  - [ ] Confirm the loop stops on max run count.
  - [ ] Confirm the loop stops on `GOAL_COMPLETE`.
  - [ ] Confirm the loop stops on `GOAL_BLOCKED`.
  - [ ] Confirm user stop works.
  - [ ] Confirm optional verification failure stops the loop.
  - [ ] Confirm auto-commit commits only when enabled and changes exist.

## Verification Guidance

Use the repo's actual scripts once they exist. The expected verification path should become:

- `npm run typecheck`
- `npm test` or the closest available focused test command
- `npm run build`
- Manual browser verification of the main workflow

Until scripts exist, each implementation step should include the smallest practical verification for the files changed.

Do not mark a checkbox complete unless its behavior has been implemented and verified.

## Completion Markers

Add exactly one of these markers only when appropriate:

- `GOAL_COMPLETE` when every MVP checkbox is complete and verification passes.
- `GOAL_BLOCKED` only when the user explicitly asks Codex to persist blocked status in `goal.md`.
