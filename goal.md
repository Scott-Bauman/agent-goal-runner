# codex-goal-runner Goal

## Goal

Build and maintain `codex-goal-runner`, a lightweight local developer tool for running the user's existing Codex CLI against a selected repository's repo-local `goal.md`.

The MVP is a browser-based operations panel backed by a local Node.js server. It lets the user select a local repository, view or create its `goal.md`, configure a repeat prompt and run count, run `codex exec <prompt>` in a controlled loop, optionally verify and commit after successful runs, and stop safely when a stop condition is reached.

## Product Shape

- Primary surface: local browser operations panel.
- Backend: Fastify, Node.js, ESM TypeScript.
- Frontend: Vite, React, TypeScript, Tailwind CSS, and focused shadcn/ui components.
- Main workflow: select repository, inspect `goal.md`, configure loop settings, run Codex, stream logs/status, refresh goal rendering, stop on configured conditions.
- UX priority: compact, quiet, professional, and useful during repeated local development runs.

## Scope

### In Scope

- Local-only repository selection and runtime state.
- Reading, rendering, watching, and explicitly creating only `<selected-repo>/goal.md`.
- Sanitized markdown rendering with `marked` and DOMPurify.
- Server-Sent Events for status, logs, run progress, summaries, and goal-file changes.
- `chokidar` watching of the selected repository's `goal.md` only.
- `zod` validation for request bodies, paths, run configuration, and goal creation.
- `child_process.spawn()` for Codex, git, and optional verification commands.
- Calling Codex as `codex exec <prompt>` in the selected repository.
- Optional verification after successful Codex runs.
- Optional auto-commit after Codex and verification succeed.
- In-memory runtime state only.

### Out of Scope

- Electron, Tauri, hosted execution, or remote repository browsing.
- Database persistence or run history across server restarts.
- Model provider configuration, OpenAI API keys, or API-key entry flows.
- Code editor, file tree, arbitrary markdown browser, or diff viewer.
- Plugin system or multi-goal workflows.
- Support for durable plan files other than `goal.md`.
- Telemetry, analytics, or remote log upload.

## Durable Control File Rules

- `goal.md` is the only supported durable goal/control file.
- The app must not support `refactor.md`, `migration.md`, alternate plan files, arbitrary markdown files, or a file tree.
- This repository's `goal.md` controls implementation work on `codex-goal-runner`.
- A selected target repository's `<selected-repo>/goal.md` is runtime user data that the app reads, renders, watches, and makes available to Codex by running Codex in that repository.
- The app may create a default `goal.md` in the selected target repository only when the user explicitly requests creation.
- The app process itself must not directly edit a selected repository's `goal.md` except when creating the default file.
- Codex runs launched in a selected repository may edit that repository's `goal.md` according to that repository's own instructions and the user's run prompt.

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
- Keep logs local.
- Add third-party packages or shadcn/ui components only when directly needed for the selected work.
- Before running any install or download command, request command approval through the sandbox escalation flow and state what will be installed.
- Do not use persistent prefix approval for dependency install commands unless the user explicitly asks for it.
- Do not add unused dependencies or component scaffolding.

## Execution Rules

- Use this `goal.md` as the source of truth.
- Complete the next valid unchecked item only.
- A valid item is the first unchecked checkbox whose dependencies are complete and whose work can be safely completed in one focused pass.
- Split oversized checklist items before implementing them.
- Do not broaden scope beyond the selected checkbox.
- Do not scaffold future phases unless required by the selected checkbox.
- Keep each change independently verifiable.
- Preserve existing behavior unless the selected item explicitly changes it.
- Do not rename scripts, endpoints, event names, request fields, response fields, persisted assumptions, public APIs, IPC channels, exported functions, props, or files unless the selected item requires it.
- Update only the relevant checkbox state after verified completion.
- Do not add run logs, reasoning traces, routine progress notes, or command output to this file.

## Implementation Plan

No active implementation checklist is currently defined.

When new work is requested, add only small unchecked items that are independently verifiable and inside the scope above.

## Verification

Use the narrowest verification that proves the selected checkbox.

Expected commands:

- `npm run typecheck`
- `npm test` or the closest focused test command
- `npm run lint`
- `npm run build`

Do not mark a checkbox complete if the changed path has active test failures, type errors, lint errors, build failures, runtime exceptions, relevant console errors, or obvious regressions.

For small documentation-only changes, no code verification is required, but the markdown should be reviewed for consistency.

## Browser / Visual Verification Policy

Do not run visual browser inspection, `agent-browser`, Playwright, Cypress, headed browser checks, screenshot checks, or browser automation during normal goal execution.

Default verification should use non-visual commands only:

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- targeted HTTP/API checks when relevant

Only run visual browser verification when the user explicitly asks for it in the current prompt.

## Blocked / Complete Policy

- Report blocked runs as `GOAL_BLOCKED` with the exact reason.
- Do not persist `GOAL_BLOCKED` in this file unless the user explicitly asks.
- Add `GOAL_COMPLETE` only when every required checkbox is complete and final verification passes.
- Do not add completion markers during ordinary intermediate runs.

GOAL_COMPLETE
