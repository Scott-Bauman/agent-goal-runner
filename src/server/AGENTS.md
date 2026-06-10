# AGENTS.md

- Backend is Fastify on `127.0.0.1:4317`; entrypoints are `index.ts` and `server.ts`.
- Build all routes from `buildServer`. Share mutable server state only through `ServerRuntimeContext`; keep route handlers thin and put orchestration in domain modules.
- Validate request bodies and query strings with Zod. Return `validationError(...)` with issue arrays for client-facing validation failures, and keep issue paths stable for the frontend.
- Repository access is restricted to the selected repository. Only read or create that repository's root `goal.md`; never accept arbitrary markdown or filesystem paths from the browser.
- Guard run-sensitive operations with route guards. Branch changes, repository mutation, skill installation, and run starts must respect active-run state.
- Run-loop code in `runner/` must use the injected `ProcessSpawner`; tests should not spawn real Codex, Claude, git, or shell processes.
- Verification commands are executable-plus-args only. Reject shell operators and shell wrappers before spawning.
- Auto-commit and review behavior belongs in `RunController`; keep provider-specific option validation aligned with `runner/agentProviders.ts`, `codexOptions.ts`, and `claudeOptions.ts`.
- SSE state and payload changes must stay aligned with `src/web/events/runtimeStream.ts`, `src/server/sse/types.ts`, and the matching tests.
- When adding routes, add focused route tests under `tests/server/routes`; use helper fixtures instead of real user repositories whenever possible.
