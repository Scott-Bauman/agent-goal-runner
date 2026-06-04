# codex-goal-runner

Lightweight local operations panel for repeatedly running the Codex CLI against a selected repository's `goal.md`.

The MVP is currently through Phase 4 backend run-loop control. It has a Fastify backend, a Vite React frontend, Tailwind styling, focused UI primitives for the first screen, local API endpoints for selecting a repository plus reading or creating that repository's `goal.md`, Server-Sent Events for status and `goal.md` change notifications, and a controlled Codex run loop. Runtime goal rendering, optional verification, and auto-commit features are tracked in `goal.md`.

## Current Behavior

- Backend server starts on `127.0.0.1:4317` by default.
- Backend exposes `GET /` with the app name and status, plus `GET /health` for a simple health check.
- Frontend starts with Vite and renders the initial operations-panel shell.
- The initial shell shows the app name, idle status badge, and repository selection button.
- Repository selection is available through `POST /api/repository/select` with a JSON body containing an absolute local `path`.
- The selected path must exist, be a directory, and include a `.git` marker directory or worktree marker file.
- The selected repository is kept only in server memory and can be read with `GET /api/repository/selection`.
- The backend reads only the selected repository's `goal.md` through `GET /api/goal`.
- Missing goals return a clear `GOAL_MISSING` response so the frontend can offer creation.
- A default `goal.md` can be created only by explicit request with `POST /api/goal`, and existing goals are not overwritten.
- Goal API requests reject caller-provided alternate markdown paths or plan names.
- Validation failures return frontend-ready issue details with `VALIDATION_ERROR`.
- Server-Sent Events are available through `GET /api/events`.
- New SSE clients receive the current `status`, `logs`, `progress`, and `summary` snapshot.
- Selecting a repository starts or replaces a watcher for only that repository's `goal.md`.
- Repository selection changes broadcast a `status` event with the selected repository path.
- `goal.md` add, change, and unlink events broadcast `goalChanged` with the repository path, goal path, and existence state.
- Run-loop statuses include `idle`, `running`, `stopping`, `complete`, `blocked`, `failed`, and `stopped`.
- Codex runs start through `POST /api/run/start` with a non-empty `prompt` and a `runCount` from 1 through 100.
- The run loop requires a selected repository, rejects concurrent starts, and spawns `codex exec <prompt>` inside the selected repository for each pass.
- Codex stdout and stderr stream to connected SSE clients as log entries.
- After each successful Codex pass, the backend re-reads the selected repository's `goal.md`.
- The run loop stops when Codex exits non-zero, the requested run count is reached, refreshed `goal.md` contains `GOAL_COMPLETE` or `GOAL_BLOCKED`, `goal.md` becomes unavailable, or the user requests stop.
- User stop is available through `POST /api/run/stop`; it marks the run as stopping, terminates the active Codex process when possible, and prevents additional passes from starting.
- Run progress and latest summary updates are broadcast over SSE.
- Shared development scripts are available for local dev, type checking, linting, tests, and production builds.

## Requirements

- Node.js 20 or newer
- npm
- Codex CLI installed and authenticated for run-loop execution

## Local Development

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

Open the frontend URL in a browser to view the current scaffold UI. Use `http://127.0.0.1:4317/health` to confirm the backend is running.

You can also run each side separately:

```sh
npm run dev:server
npm run dev:web
```

## Run Loop API

After selecting a repository with `POST /api/repository/select`, start a controlled Codex loop with:

```sh
curl -X POST http://127.0.0.1:4317/api/run/start \
  -H "Content-Type: application/json" \
  -d "{\"prompt\":\"Use goal.md as the source of truth. Complete the next valid unchecked item.\",\"runCount\":1}"
```

Request a stop for the active run with:

```sh
curl -X POST http://127.0.0.1:4317/api/run/stop
```

Subscribe to status, log, progress, summary, and `goal.md` change events with `GET /api/events`.

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

## Project Control

Implementation work is controlled by this repository's `goal.md`. Future Codex runs should complete one valid unchecked checkbox or sub-checkbox at a time, verify the change, and update only the completed checkbox in `goal.md`.
