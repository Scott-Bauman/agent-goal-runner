# AGENTS.md

- Frontend is Vite React; imports use `@/web/...`.
- `App.tsx` owns repository selection, SSE subscription, runner status, and the goal refresh token.
- Keep feature UI under `components/app`; reuse primitives from `components/ui`.
- API response/error helpers live in `api/`; keep shapes compatible with Fastify route responses.
- Runtime stream parsing and event types live in `events/runtimeStream.ts`; update alongside backend SSE payload changes.
- Render goal markdown only through `markdown.ts` (`marked` + DOMPurify); do not inject raw markdown HTML elsewhere.
