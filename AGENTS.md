# AGENTS.md

- App: local Agent CLI run panel for running goal-driven Codex or Claude loops from a browser UI.
- Stack: Node 20+ ESM TypeScript, Fastify backend in `src/server`, Vite React frontend in `src/web`, mirrored tests in `tests/server` and `tests/web`.
- Shared contracts matter. Keep API response shapes, SSE payloads, runner statuses, provider/model options, and validation errors aligned between server, web, and tests.
- Prefer narrow changes in the owning layer. Put backend orchestration, filesystem, git, process, and skill-install work under `src/server`; keep browser state, rendering, and form behavior under `src/web`.
- `goal.md` controls project work; update it only when a checkbox is actually completed. Do not treat partial implementation as goal completion.
- Normal verification: `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`. For smaller changes, run the most relevant subset and state what was not run.
- Keep generated/runtime output out of source: `dist/`, `.codex-runner-logs/`, `codex-*.log`, coverage output, and local caches.
- Do not overwrite user work. The repository may have unrelated dirty files; inspect diffs before editing files that already changed.
