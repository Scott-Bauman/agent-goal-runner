# codex-goal-runner

Lightweight local operations panel for repeatedly running the Codex CLI against a selected repository's `goal.md`.

The MVP has completed Phase 8 run controls and live status. It has a Fastify backend, a Vite React frontend, Tailwind styling, focused shadcn/ui primitives for the operations panel, local API endpoints for selecting a repository plus reading or creating that repository's `goal.md`, Server-Sent Events for status and `goal.md` change notifications, a controlled Codex run loop, optional verification, optional auto-commit, sanitized runtime markdown rendering, editable repeat prompt, run count, and verification command fields, a local auto-commit switch, start/stop controls wired to the run-loop API, and connected live status, progress, logs, and latest-summary display.

## Current Behavior

- Backend server starts on `127.0.0.1:4317` by default.
- Backend exposes `GET /` with the app name and status, plus `GET /health` for a simple health check.
- Frontend starts with Vite and renders a responsive operations-panel shell.
- shadcn/ui is configured with local aliases, Tailwind semantic tokens, and generated focused primitives for badges, buttons, cards, empty states, inputs, and textareas.
- The top bar shows the app name, selected repository path state, and locally tracked runner status badge.
- The main workspace has a left rendered `goal.md` document panel, a compact right-side controls panel, and a bottom logs plus latest-summary panel.
- Repository path entry is available in the controls panel with selected-path display and frontend-ready validation errors.
- When the selected repository has no `goal.md`, the document panel shows a generated shadcn/ui empty state with an explicit create-default-`goal.md` action.
- The repeat prompt textarea is editable and prefilled with a goal-driven default prompt for future run starts.
- The run count input is editable and uses the same 1 through 100 numeric bounds accepted by the backend start endpoint.
- The optional verification command input is editable and accepts the same single-command style that the backend validates when run starts are connected.
- The auto-commit switch can be toggled locally in the controls panel and is included in run submissions.
- The Start button submits the repeat prompt, run count, optional verification command, and auto-commit flag to `POST /api/run/start`.
- The Start button is disabled until a repository is selected, the prompt is non-empty, the run count is from 1 through 100, no run is active, and no run-control request is pending.
- The Stop button submits `POST /api/run/stop` and is enabled only while the frontend has a running status and no run-control request is pending.
- The frontend connects to `GET /api/events` with EventSource and tracks the stream as connecting, open, or errored.
- The top status badge updates from backend `status` events.
- The logs panel renders streamed system, stdout, and stderr entries from backend `logs` events.
- The logs header and latest-summary panel render current run progress from backend `progress` events.
- The latest-summary panel renders the most recent run-loop message from backend `summary` events.
- Vite proxies frontend `/api/*` requests to the local backend during development.
- Repository selection is available through `POST /api/repository/select` with a JSON body containing an absolute local `path`.
- The selected path must exist, be a directory, and include a `.git` marker directory or worktree marker file.
- The selected repository is kept only in server memory and can be read with `GET /api/repository/selection`.
- The backend reads only the selected repository's `goal.md` through `GET /api/goal`.
- Missing goals return a clear `GOAL_MISSING` response so the frontend can offer creation.
- A default `goal.md` can be created only by explicit request with `POST /api/goal`, and existing goals are not overwritten.
- Goal API requests reject caller-provided alternate markdown paths or plan names.
- Validation failures return frontend-ready issue details with `VALIDATION_ERROR`.
- Available `goal.md` content is converted with `marked` using GitHub-flavored markdown and sanitized with DOMPurify before rendering in the browser.
- Rendered markdown includes readable styling for headings, lists, task checkboxes, links, inline code, code blocks, blockquotes, rules, and tables.
- Server-Sent Events are available through `GET /api/events`.
- New SSE clients receive the current `status`, `logs`, `progress`, and `summary` snapshot.
- Selecting a repository starts or replaces a watcher for only that repository's `goal.md`.
- Repository selection changes broadcast a `status` event with the selected repository path.
- `goal.md` add, change, and unlink events broadcast `goalChanged` with the repository path, goal path, and existence state.
- The frontend refreshes the rendered `goal.md` after matching `goalChanged` events and after complete or blocked run summaries.
- Run-loop statuses include `idle`, `running`, `stopping`, `complete`, `blocked`, `failed`, and `stopped`.
- Codex runs start through `POST /api/run/start` with a non-empty `prompt` and a `runCount` from 1 through 100.
- The run loop requires a selected repository, rejects concurrent starts, and spawns `codex exec <prompt>` inside the selected repository for each pass.
- Codex stdout and stderr stream to connected SSE clients as log entries.
- After each successful Codex pass, the backend re-reads the selected repository's `goal.md`.
- The run loop stops when Codex exits non-zero, the requested run count is reached, refreshed `goal.md` contains `GOAL_COMPLETE` or `GOAL_BLOCKED`, `goal.md` becomes unavailable, or the user requests stop.
- User stop is available through `POST /api/run/stop`; it marks the run as stopping, terminates the active Codex process when possible, and prevents additional passes from starting.
- Optional verification is accepted as an empty value or a single executable with arguments; shell operators and shell wrappers are rejected.
- Verification runs only after a successful Codex pass, streams stdout and stderr over SSE, and stops the run loop on failure.
- Auto-commit is opt-in per run. When enabled, the backend runs `git add -A`, checks `git status --porcelain`, skips commits when there are no changes, creates a generated commit message when changes exist, streams git output over SSE, and stops the run loop on git failure.
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

Open the frontend URL in a browser to select a repository, render its `goal.md`, configure a run, and watch live status, logs, progress, and the latest run summary. Use `http://127.0.0.1:4317/health` to confirm the backend is running.

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
  -d "{\"prompt\":\"Use goal.md as the source of truth. Complete the next valid unchecked item.\",\"runCount\":1,\"verificationCommand\":\"npm test\",\"autoCommit\":false}"
```

Request a stop for the active run with:

```sh
curl -X POST http://127.0.0.1:4317/api/run/stop
```

Subscribe to status, log, progress, summary, and `goal.md` change events with `GET /api/events`.

The frontend subscribes to this stream automatically during local development and updates the status badge, live logs, run progress, latest summary, and rendered `goal.md` refreshes from those events.

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
