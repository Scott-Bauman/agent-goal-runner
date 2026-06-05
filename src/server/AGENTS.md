# AGENTS.md

- Backend is Fastify on `127.0.0.1:4317`; entrypoints are `index.ts` and `server.ts`.
- Register routes from `buildServer`; share mutable server state through `ServerRuntimeContext`.
- Validate request bodies with Zod and return `validationError(...)` issue arrays for client-facing validation failures.
- Repository access is restricted to the selected repo and its root `goal.md`; do not accept arbitrary markdown paths.
- Run-loop code in `runner/` must use injected `ProcessSpawner`; tests should not spawn real Codex or git processes.
- SSE payload changes must stay aligned with `src/web/events/runtimeStream.ts`.
