# Contributing

Thanks for helping improve `agent-goal-runner`.

## Local Setup

```sh
npm install
npm run dev
```

The backend runs on `http://127.0.0.1:4317`. Vite prints the frontend URL, usually `http://127.0.0.1:5173`.

## Verification

Before opening a pull request, run:

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

For package-related changes, also run:

```sh
npm pack --dry-run
```

## Project Notes

- Backend code lives in `src/server`.
- Frontend code lives in `src/web`.
- Tests mirror those areas under `tests/server` and `tests/web`.
- Keep generated output out of source, including `dist/`, `coverage/`, `.codex-runner-logs/`, and `*.tgz`.
- Do not commit secrets, local logs, machine-specific paths, or provider credentials.

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for detailed architecture and workflow notes.
