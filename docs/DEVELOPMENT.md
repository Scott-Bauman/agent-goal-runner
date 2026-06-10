# Development Guide

This guide preserves the development-focused details for `agent-goal-runner`. The public README is intentionally shorter.

## Prerequisites

- Node.js 20 or newer
- npm
- Git for repository validation, branch operations, and auto-commit
- Codex CLI installed and authenticated for Codex runs
- Claude CLI installed and authenticated only when using the Claude provider

## Local Setup

Install dependencies:

```sh
npm install
```

Start the backend and frontend together:

```sh
npm run dev
```

By default:

- Backend: `http://127.0.0.1:4317`
- Frontend: Vite's printed local URL, usually `http://127.0.0.1:5173`

Use `http://127.0.0.1:4317/health` to confirm the backend is running.

You can also run each side separately:

```sh
npm run dev:server
npm run dev:web
```

For a built local app:

```sh
npm install
npm run build
npm run install:skill:global
npm start
```

By default, `npm start` runs the built backend on `http://127.0.0.1:4317`. The backend serves the built frontend from `dist/web`, so the app and API share the same localhost origin.

After the package is published, users should be able to start the same built server with:

```sh
npx agent-goal-runner
```

Repo-local skill installation is often the most reliable option when using the app across different selected repositories because Codex can load the skill directly from that repository:

```sh
npm run install:skill:repo -- "C:\path\to\target-repo"
```

## Npm Scripts

Scripts are defined in `package.json`.

| Script | Behavior |
| --- | --- |
| `npm run dev` | Runs backend and frontend development servers together with `concurrently`. |
| `npm start` | Starts the built backend from `dist/server/index.js`; the backend serves the built frontend from `dist/web`. |
| `npm run start:server` | Starts the built backend from `dist/server/index.js`. |
| `npm run dev:server` | Watches and runs `src/server/index.ts` with `tsx`. |
| `npm run dev:web` | Starts Vite on `127.0.0.1`. |
| `npm run preview:web` | Serves only the built frontend with Vite preview for frontend-only inspection. |
| `npm run typecheck` | Runs TypeScript checks for the web and server configs. |
| `npm run lint` | Runs ESLint over the repository. |
| `npm test` | Runs Vitest with coverage and `--passWithNoTests`. |
| `npm run build` | Builds web and server outputs. |
| `npm run build:server` | Compiles the server with `tsconfig.server.json`. |
| `npm run build:web` | Builds the Vite frontend. |
| `npm run install:skill:global` | Installs the bundled `goal-runner-framework` skill globally. |
| `npm run install:skill:repo` | Installs the bundled skill into a target repository. |
| `npm run prepublishOnly` | Runs the publish gate: typecheck, lint, tests, and build. |

## Project Structure

- `src/server`: Fastify backend, local repository selection, goal file access, SSE, skill routes, branch routes, and run-loop orchestration.
- `src/web`: Vite React frontend, operations panel UI, runtime stream handling, API response types, and markdown rendering.
- `tests/server`: Backend unit and route tests.
- `tests/web`: Frontend unit and component tests.
- `bundled-skills/goal-runner-framework`: Skill bundled with the app for goal-driven Codex runs.
- `scripts`: Local skill installation scripts.

## Package Publishing Preparation

The npm package is intended to contain only the built runtime, bundled skill files, README, license, and user-facing docs/assets. Source files, tests, coverage, logs, caches, and development-only config should not be published.

Before publishing:

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm pack --dry-run
```

Inspect the `npm pack --dry-run` output before publishing. It should include `dist/server`, `dist/web`, `bundled-skills`, `README.md`, `LICENSE`, `docs/DEVELOPMENT.md`, `docs/TROUBLESHOOTING.md`, and `docs/assets`. It should not include `src`, `tests`, `coverage`, `node_modules`, `.codex-runner-logs`, or stale root-level Vite output under `dist/assets`.

Before publishing, confirm `package.json` repository, bugs, and homepage metadata still point to the intended GitHub repository.

## Current Local Behavior

- Backend server starts on `127.0.0.1:4317` by default.
- In development, backend exposes `GET /` with app status and `GET /health` for a health check.
- In built startup, backend serves the frontend app shell at `GET /` and still exposes `GET /health` for a health check.
- Vite proxies frontend `/api/*` requests to the local backend during development.
- Built frontend assets are emitted to `dist/web` and are served by the backend during `npm start`.
- Frontend renders an operations panel with repository status, branch controls, rendered `goal.md`, run controls, logs, and latest summary.
- Repository selection uses `POST /api/repository/browse`, which opens a native folder picker on the backend host.
- The selected path must exist, be a directory, and include a `.git` marker directory or worktree marker file.
- The selected repository is kept only in server memory and can be read with `GET /api/repository/selection`.
- The backend reads only the selected repository's `goal.md` through `GET /api/goal`.
- Missing goals return a `GOAL_MISSING` response so the frontend can offer creation.
- A default `goal.md` can be created only by explicit request with `POST /api/goal`; existing goals are not overwritten.
- Available `goal.md` content is rendered with `marked` and sanitized with DOMPurify before browser display.
- Server-Sent Events are available through `GET /api/events`.
- New SSE clients receive the current `status`, `logs`, `progress`, and `summary` snapshot.
- Selecting a repository starts or replaces a watcher for only that repository's `goal.md`.
- `goal.md` add, change, and unlink events broadcast `goalChanged`.
- The frontend refreshes rendered `goal.md` after matching `goalChanged` events and after complete or blocked run summaries.
- Branch APIs expose local branch list, switch, create, merge, and delete operations for the selected repository.

## Run Loop Behavior

Agent runs start through `POST /api/run/start` with a non-empty `prompt` and a `runCount` from 1 through 100. The request can select the Codex or Claude provider, model options, optional verification commands, optional auto-commit, and optional review settings.

The run loop:

- Requires a selected repository.
- Rejects concurrent starts.
- Spawns the configured local agent CLI inside the selected repository.
- Streams agent stdout and stderr to connected SSE clients.
- Re-reads the selected repository's `goal.md` after each successful pass.
- Stops when the agent exits non-zero, the requested run count is reached, refreshed `goal.md` contains `GOAL_COMPLETE` or `GOAL_BLOCKED`, `goal.md` becomes unavailable, or the user requests stop.
- Terminates the active process when possible after `POST /api/run/stop`.

Optional verification commands are parsed as a single executable plus arguments. Shell operators and shell wrappers are rejected. Verification runs after successful agent passes and stops the loop on failure.

Auto-commit is opt-in per run. When enabled, the backend runs `git add -A`, checks `git status --porcelain`, skips commits when there are no changes, creates a generated commit message when changes exist, streams Git output over SSE, and stops the run loop on Git failure.

Review runs are optional and require auto-commit to be enabled. Review configuration uses the same provider-specific model validation as normal agent runs.

## Run Loop API

After selecting a repository with `POST /api/repository/browse`, start a controlled loop with:

```sh
curl -X POST http://127.0.0.1:4317/api/run/start \
  -H "Content-Type: application/json" \
  -d "{\"prompt\":\"Use goal.md as the source of truth. Complete the next valid unchecked item.\",\"runCount\":1,\"verificationCommands\":[\"npm test\"],\"autoCommit\":false}"
```

Request a stop for the active run with:

```sh
curl -X POST http://127.0.0.1:4317/api/run/stop
```

Subscribe to status, log, progress, summary, and `goal.md` change events with `GET /api/events`. The frontend subscribes automatically during local development.

## Verification

Run type checking:

```sh
npm run typecheck
```

Run tests:

```sh
npm test
```

Run linting:

```sh
npm run lint
```

Build production outputs:

```sh
npm run build
```

Browser automation is intentionally not part of normal verification for this project; visual checks are manual unless explicitly requested.

## Maintainer Notes

- Implementation work for this repository is controlled by `goal.md`.
- Future agent runs should complete one valid unchecked checkbox or sub-checkbox at a time, verify the change, and update only the completed checkbox in `goal.md`.
- Keep generated and runtime output out of source, including `dist/`, `.codex-runner-logs/`, and `codex-*.log`.
- Backend code lives in `src/server`; frontend code lives in `src/web`; tests mirror under `tests/server` and `tests/web`.

## Local Development Caveats

- The folder picker runs on the backend host, not in the browser sandbox.
- Selected repository state is in memory and is not persisted across server restarts.
- Branch operations are blocked while a run is active.
- Auto-commit operates on the selected repository, not this app repository unless this app repository is selected.
- Verification commands run in the selected repository and must be expressible without shell operators.
- Codex and Claude runs depend on locally installed and authenticated CLI tools.
