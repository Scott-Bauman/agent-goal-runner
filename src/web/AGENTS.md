# AGENTS.md

- Frontend is Vite React; imports use `@/web/...`.
- `App.tsx` owns repository selection, SSE subscription, runner status, and the goal refresh token. Keep lower components focused on rendering and local form behavior.
- Keep feature UI under `components/app`; reuse primitives from `components/ui` and lucide icons for button/icon affordances.
- API response and error helpers live in `api/`; keep shapes compatible with Fastify route responses and preserve validation issue display behavior.
- Runtime stream parsing and event types live in `events/runtimeStream.ts`; update them alongside backend SSE payload changes and matching tests.
- Runner/provider option lists live under `runner/`; keep Codex and Claude model fields mutually exclusive in requests.
- Controls panel review helpers live in `components/app/controlsPanelReview.ts`; keep review request shaping there instead of duplicating it in JSX.
- Render goal markdown only through `markdown.ts` (`marked` + DOMPurify); do not inject raw markdown HTML elsewhere.
- Prefer accessible controls: labels or `sr-only` labels for inputs, `aria-invalid`/`aria-describedby` for validation, and disabled states that match backend constraints.
- For UI changes, add or update focused tests under `tests/web`, including component tests when behavior depends on user interaction.
