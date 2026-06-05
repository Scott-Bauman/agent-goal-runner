# AGENTS.md

- App: local Agent CLI run panel. Backend lives in `src/server`; frontend lives in `src/web`; tests mirror under `tests/server` and `tests/web`.
- Use Node 20+ ESM TypeScript. Shared checks: `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`.
- `goal.md` controls project work; update it only when a checkbox is actually completed.
- Keep generated/runtime output out of source: `dist/`, `.codex-runner-logs/`, `codex-*.log`.
