# codex-goal-runner

Lightweight local operations panel for repeatedly running the Codex CLI against a selected repository's `goal.md`.

The MVP is currently in Phase 1 scaffold form. It has a Fastify backend, a Vite React frontend, Tailwind styling, and focused UI primitives for the first screen. Runtime repository selection, goal rendering, run-loop control, verification, and auto-commit features are tracked in `goal.md`.

## Current Phase 1 Behavior

- Backend server starts on `127.0.0.1:4317` by default.
- Backend exposes `GET /` with the app name and status, plus `GET /health` for a simple health check.
- Frontend starts with Vite and renders the initial operations-panel shell.
- The initial shell shows the app name, idle status badge, and repository selection button.
- Shared development scripts are available for local dev, type checking, linting, tests, and production builds.

## Requirements

- Node.js 20 or newer
- npm
- Codex CLI installed and authenticated for future run-loop features

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
