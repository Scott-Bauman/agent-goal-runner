# Troubleshooting

This page covers common local setup and run-loop issues for `agent-goal-runner`.

## Backend Health Check

If the frontend cannot connect, confirm the backend is running:

```sh
curl http://127.0.0.1:4317/health
```

During development, `npm run dev` starts both the backend and Vite frontend. For a built app, `npm start` starts the built backend, which also serves the built frontend at `http://127.0.0.1:4317`. You can isolate development issues by running:

```sh
npm run dev:server
npm run dev:web
```

`npx agent-goal-runner` starts the same built local server. If `npx` starts successfully but the browser cannot connect, check the terminal for the host and port, then open the printed localhost URL.

## Repository Selection Fails

The selected path must:

- Exist.
- Be a directory.
- Include a `.git` directory or Git worktree marker file.

If selection fails with a Git repository message, choose the repository root rather than a nested source folder.

Repository selection is stored only in server memory. If you restart the backend, select the repository again.

## Native Folder Picker Does Not Open

The folder picker is opened by the backend process on the host machine. If it fails, check the backend terminal output. The app reports unsupported or failed folder picker commands as API errors.

## `goal.md` Is Missing

When the selected repository has no `goal.md`, the app returns `GOAL_MISSING` and the frontend offers to create a default file. Existing `goal.md` files are not overwritten by the create action.

## Codex, Claude, Or Pi Fails To Start

Codex runs require the Codex CLI to be installed, authenticated, and available on `PATH`.

Claude runs require the Claude CLI to be installed, authenticated, and available on `PATH`.

Pi runs require the Pi harness to be installed and available on `PATH`. Local model availability and any model aliases are handled by the harness.

If a run fails immediately with a start or spawn error, confirm the relevant CLI works from a terminal in the selected repository.

For Codex, authenticate with the Codex CLI itself before starting a run. This app reuses the local CLI session and does not perform provider login. For Pi, leave the model field empty to use the harness default or enter the local model name exactly as the harness expects it.

## `goal-runner-framework` Skill Is Missing

For Codex goal-driven runs, install the bundled skill globally:

```sh
npm run install:skill:global
```

Or install it into the selected repository:

```sh
npm run install:skill:repo -- "C:\path\to\target-repo"
```

Repo-local installation can be more reliable when switching between selected repositories.

When running from an installed npm package, the UI installs the bundled skill from the package installation directory. It should not depend on the directory where you launched `npx agent-goal-runner`.

## `npx agent-goal-runner` Cannot Find Built Files

The npm package must include `dist/server`, `dist/web`, and `bundled-skills`. If the CLI reports that `dist/web/index.html` is missing, the package was built or packed incorrectly. From a source checkout, run:

```sh
npm run build
npm pack --dry-run
```

Confirm the dry-run output includes `dist/web/index.html`, `dist/server/cli.js`, and `dist/server/index.js`.

## Verification Command Is Rejected

Verification commands must be a single executable plus arguments. Shell operators and shell wrappers are rejected.

Examples that fit the expected shape:

```sh
npm test
npm run typecheck
```

Avoid command strings that rely on shell features such as pipes, `&&`, `||`, redirection, subshells, or wrapper commands.

## Verification Fails During A Run

Verification runs after a successful agent pass. By default, if verification exits non-zero, the run loop stops and streams stdout and stderr to the logs panel. If the run was configured to repair verification failures, the app starts a limited repair agent attempt, includes the failed command output in the repair prompt, and reruns verification before continuing. Run the same command manually in the selected repository to reproduce a failure that still does not repair cleanly.

## Auto-Commit Fails

Auto-commit requires Git to be installed and available on `PATH`. It runs in the selected repository.

The app stages all changes with `git add -A`, checks `git status --porcelain`, skips commits when there are no changes, and creates a generated commit when changes exist. If Git exits non-zero, the run loop stops and streams Git output to the logs panel.

## Branch Controls Are Disabled

Branch switch, create, merge, and delete operations are blocked while a run is active. Stop or finish the run before changing branches.

The app also rejects invalid branch operations such as deleting the current branch, merging the current branch into itself, or operating while HEAD is detached for merge.

## SSE Status Looks Disconnected

The frontend uses `GET /api/events` for live status, logs, progress, summaries, and `goal.md` change notifications. If the SSE connection badge does not open:

- Confirm the backend health check succeeds.
- During development, confirm Vite is proxying `/api/*` to the backend.
- For a built app, confirm `npm run build` completed so `dist/web/index.html` exists before starting `npm start`.
- Restart `npm run dev` or `npm start` if either process stopped.
- Check the browser console and backend terminal for API errors.
