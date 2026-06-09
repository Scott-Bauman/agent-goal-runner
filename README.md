# agent-goal-runner

Run long agent coding tasks as a controlled series of fresh, goal-driven passes. Works with your Codex and Claude subscription!

`agent-goal-runner` is a local browser app for developers who use `goal.md` to steer agent work. Select a repository, keep the goal visible, start a repeatable run loop, and watch each pass execute with live logs, progress, summaries, optional verification, and optional Git commits.

![Agent Goal Runner UI](docs/assets/image.png)

The core idea is simple: instead of asking one overloaded agent session to carry a long task forever, the app repeatedly starts focused CLI passes from the selected repository. Each pass can re-read the current `goal.md`, work on the next valid step, and stop when the goal says the task is complete or blocked. That keeps context fresh, makes progress easier to inspect, and gives you safer checkpoints during larger implementation work.

Use it when you want agent automation to stay tied to a local repo, a visible goal file, and the same checks you would run yourself.

## Why Use It

- Keep long tasks moving without depending on one increasingly stale conversation context.
- Use `goal.md` as a durable source of truth for what the agent should do next.
- Watch runs from a local UI instead of stitching together terminal output by hand.
- Add verification commands so a pass has to prove itself before the loop continues.
- Optionally commit successful work between passes so progress has clear checkpoints.
- Stop the loop when the goal is complete, blocked, failing, or no longer safe to continue.

## Features

- Local repository picker with `goal.md` viewing and default goal creation.
- Controlled Codex or Claude run loop with configurable prompt, model options, and run count.
- Live status, logs, progress, summaries, and `goal.md` refreshes while the loop runs.
- Optional verification commands after successful agent passes.
- Optional auto-commit for successful pass results.
- Bundled `goal-runner-framework` skill installation helpers.
- Local Git branch switch, create, merge, delete, and refresh controls.

## What It Is Not

- It is not a hosted service or multi-user web app.
- It is not an agent provider; it shells out to locally installed CLI tools.
- It is not a replacement for Git review, tests, or human judgment.
- It is not published as an npm package; it is intended to run from a local clone.

## Requirements

- Node.js 20 or newer
- npm
- Git
- Codex CLI or Claude CLI 

## Installation

Clone the repository, then install dependencies:

```sh
npm install
```

Then run locally:

```sh
npm run build
npm start
```

## Highly Recomended Skill 

Install the bundled `goal-runner-framework` skill globally or into the repository you plan to automate:

```sh
npm run install:skill:global
npm run install:skill:repo -- "C:\path\to\target-repo"
```

There are also buttons in the UI that will run these scripts for you if you do not want to.

This skill allows your agent to make goal.md files that align with this program.

It is extremely highly recommended that you download this skill as the program relies on a semi-structured output for goal.md.

## Documentation

- [Development guide](docs/DEVELOPMENT.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)


## License

MIT. See [LICENSE](LICENSE).
