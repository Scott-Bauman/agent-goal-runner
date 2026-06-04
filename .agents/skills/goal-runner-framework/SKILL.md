---
name: goal-runner-framework
description: Create, repair, or refine goal.md files for Codex-driven multi-pass implementation work. Use when making a durable Codex source-of-truth control document with scope rules, execution discipline, verification guidance, blocked handling, and completion markers.
---

# Goal Runner Framework Skill

## Purpose

Use this skill to create, repair, or refine a `goal.md` file for Codex-driven implementation work.

A strong `goal.md` is not a loose checklist. It is a durable execution control document that Codex can safely use across repeated runs. It should define the product or implementation goal, constrain scope, describe safe operating behavior, provide stop conditions, define verification requirements, and keep the document clean over time.

This skill is especially useful when creating a new program, refactoring an existing project, running a migration, building an MVP, or setting up a repeated Codex execution loop.

---

## Core Principle

`goal.md` must be the source of truth.

It should tell Codex:

- what to build,
- what is in scope,
- what is out of scope,
- what file or project rules must not be violated,
- how to choose the next unit of work,
- when a task is actually complete,
- when to stop,
- how to report completion or blockage,
- how to keep the file clean across many future runs.

A good `goal.md` should be concise enough for Codex to use repeatedly, but specific enough to prevent scope drift.

---

## When To Use This Skill

Use this skill when the user asks to:

- create a new `goal.md`,
- refine an existing `goal.md`,
- convert a rough project idea into a Codex-ready plan,
- make a Codex checklist safer,
- create a durable control file for a new program,
- repair a bloated or stale goal/refactor/migration document,
- define repeated Codex run behavior,
- build an implementation framework that can survive many Codex passes.

Do not use this skill for one-off coding tasks that do not need a durable execution control document.

---

## Source Patterns To Preserve

When creating or refining `goal.md`, preserve these patterns.

### From product-oriented `goal.md` files

Use these when the project is a new app, MVP, feature, or tool:

- Product goal / mission section.
- In-scope and out-of-scope boundaries.
- Product shape or UX shape.
- Durable control-file rules.
- Stop conditions.
- Safety rules.
- Future Codex run discipline.
- Blocked status handling.
- Implementation phases.
- Verification guidance.
- Completion markers.

### From refactor-oriented control files

Use these when the project is a migration, refactor, UI pass, cleanup, or large codebase change:

- Operating rules.
- File hygiene rules.
- Definition of done.
- API and behavior preservation rules.
- Required first pass.
- Component/file/service inventory.
- Suggested migration or execution order.
- Durable notes for decisions, approvals, and blockers.
- Rules requiring oversized work to be split before implementation.
- Rules requiring verification before checking off a task.

---

## Information To Gather Or Infer

When creating or repairing a `goal.md`, gather or infer:

- project name,
- desired end state,
- target runtime,
- current stack,
- repository ignore-file state,
- in-scope work,
- out-of-scope work,
- durable file or control-file constraints,
- user approval requirements,
- dependency restrictions,
- behavior-preservation requirements,
- safety restrictions,
- stop conditions,
- verification commands,
- expected implementation phases,
- affected files, components, routes, services, or workflows,
- known blockers,
- completion marker policy.

If some details are missing, create a conservative best-effort `goal.md` with clearly marked placeholders. Do not invent risky implementation details.

---

## Recommended `goal.md` Structure

Use this as the default structure.

```md
# [Project Name] Goal

## Product Goal

## Durable Control File Rule

## Scope

### In Scope

### Out of Scope

## Product Shape

## Stop Conditions

## Safety Rules

## Future Codex Run Discipline

## File Hygiene Rules

## Definition of Done

## Required First Pass

## Implementation Phases

## Scope Inventory

## Suggested Execution Order

## Verification Guidance

## Blocked Status Handling

## Completion Markers

## Durable Decisions / Blockers
```

Remove sections that do not apply. Keep the document concise.

---

## Section Rules

### Product Goal

State the desired end state in 2–5 paragraphs.

For a new program, include:

- what the app/tool/library is,
- who or what it serves,
- what the MVP must accomplish,
- the primary workflow,
- the target runtime or environment.

Good example:

```md
## Product Goal

Build a lightweight local developer tool named `example-runner`.

The app provides a browser-based operations panel backed by a local Node.js server. It repeatedly runs the user's existing CLI tool against a selected repository's repo-local `goal.md` file, refreshing the rendered goal document and live run status after each run.

The MVP should make it easy to select a local repository, view its `goal.md`, configure a repeat prompt and run count, run the CLI in a controlled loop, observe logs, and stop safely when the goal is complete, blocked, failed, stopped by the user, or the requested run count is reached.
```

---

### Durable Control File Rule

Use this section when the project has a source-of-truth control file.

Default version:

```md
## Durable Control File Rule

- `goal.md` is the only supported durable goal/control file.
- The app or workflow must not support alternate plan files unless explicitly approved.
- The app or workflow should read and render only the selected repository's `goal.md`.
- The app or workflow should not edit `goal.md` directly except through explicitly approved control-file operations.
```

Adapt this section for non-app projects.

---

### Scope

Use explicit in-scope and out-of-scope lists.

Rules:

- In-scope items should describe the MVP or implementation boundary.
- Out-of-scope items should prevent scope creep.
- Include rejected technologies, future features, alternate runtimes, and tempting distractions.

Template:

```md
## Scope

### In Scope

- [Technology or feature]
- [Primary workflow]
- [Required behavior]

### Out of Scope

- [Tempting but excluded feature]
- [Alternate runtime]
- [Integration not needed for MVP]
```

---

### Product Shape

Use this section when the project has a UI, CLI, API, or workflow shape.

For UI work, describe layout and feel without over-specifying implementation.

Template:

```md
## Product Shape

The app should feel like [short description].

Suggested layout:

- Top area: [purpose]
- Main area: [purpose]
- Side area: [purpose]
- Bottom area: [purpose]

Use existing design systems or approved component libraries where useful.
```

---

### Stop Conditions

Use this section when the project includes loops, automation, agentic behavior, long-running processes, or repeated runs.

Template:

```md
## Stop Conditions

The process must stop when any of these occurs:

- The child process exits with a non-zero status.
- The user presses stop.
- The configured maximum run count is reached.
- The refreshed `goal.md` contains `GOAL_COMPLETE`.
- The refreshed `goal.md` contains `GOAL_BLOCKED`.
- Verification fails.
- Required inputs are invalid or missing.
```

For non-loop projects, replace this with completion gates.

---

### Safety Rules

Use this section to prevent dangerous implementation behavior.

Default rules:

```md
## Safety Rules

- Do not request, store, or expose credentials unless explicitly required and approved.
- Do not run commands outside the selected or intended working directory.
- Validate user-provided paths and request bodies before using them.
- Avoid shell-concatenated command strings where argument arrays are practical.
- Do not add telemetry unless explicitly approved.
- Do not add new dependencies unless explicitly approved.
- Do not broaden scope beyond the selected checkbox or sub-checkbox.
```

Add domain-specific safety rules when needed.

For local developer tools:

```md
- Keep logs local.
- Do not transmit repository contents to remote services unless explicitly approved.
```

For UI refactors:

```md
- Do not change user-facing behavior unless explicitly approved.
- Large visual or interaction changes require user approval before implementation.
```

For data/API work:

```md
- Do not change persisted schema, API contracts, or external integrations unless explicitly approved.
```

---

### Future Codex Run Discipline

This is one of the most important sections.

Default version:

```md
## Future Codex Run Discipline

Future Codex runs working from this file must complete exactly one unchecked checkbox or one unchecked sub-checkbox at a time.

Rules for future runs:

- Use `goal.md` as the source of truth.
- Pick the first sensible unchecked item that can be completed independently.
- Do not complete multiple checklist items in one run unless one item is a tiny parent whose only purpose is grouping already-completed substeps.
- Keep each change independently verifiable.
- Completing an item means implementing the required project files or behavior, verifying the change, and then updating the relevant checkbox state in this `goal.md`.
- When editing `goal.md`, update only the checkbox state for the completed item and avoid rewriting unrelated sections.
- Do not interpret "update only that checkbox" as "only edit `goal.md`"; that restriction applies only to edits made inside `goal.md`.
- At the end of every phase, update `README.md` to reflect the completed behavior, commands, and usage before marking the phase complete.
- Do not mark a checkbox complete unless the required files or behavior were actually created or changed and verified.
- Do not finish or mark work complete while active bugs, failing diagnostics, failing tests, build failures, runtime exceptions, or relevant console errors remain in the changed code path.
- Do not scaffold ahead of the current checkbox.
- Do not broaden scope beyond the selected checkbox or sub-checkbox.
- If blocked, clearly say `GOAL_BLOCKED` in the Codex response with the exact reason.
- Do not add a persistent `GOAL_BLOCKED` marker to `goal.md` unless the user explicitly asks for persistent blocked status.
- Mark `GOAL_COMPLETE` only when every required checkbox is complete and verification passes.
```

---

### File Hygiene Rules

Default version:

```md
## File Hygiene Rules

- Keep this file as a concise execution control document, not an implementation journal.
- Do not add progress summaries, implementation notes, reasoning traces, or routine observations.
- Only edit this file to:
  - check off verified completed items,
  - split oversized items into smaller actionable unchecked steps,
  - add newly discovered required work,
  - remove or mark retired work only after the corresponding code removal is verified,
  - record blockers, user approvals, or decisions that materially affect future work.
- Keep notes short and durable.
- If a note will not matter to a future run, do not write it here.
```

---

### Definition of Done

Default version:

```md
## Definition of Done

A checklist item is complete only when:

- the relevant code or documentation has been implemented,
- behavior preservation has been reviewed,
- active bugs in the touched code path have been investigated and fixed or explicitly classified as pre-existing blockers,
- the most focused available verification command has passed,
- broader verification has been run when appropriate,
- diagnostics, test failures, build failures, runtime errors, console errors, and lint/type errors introduced or exposed by the change are resolved,
- the relevant checkbox has been checked off in this file.
```

For visible UI work, add:

```md
For visible UI changes:

- Preserve existing props, callbacks, state transitions, keyboard behavior, persistence behavior, and runtime behavior.
- Preserve existing visual hierarchy unless the user approved a visual/design change.
- Use approved component libraries only when already installed or explicitly approved.
- Add or update targeted tests when rendering structure, accessibility behavior, or interaction behavior changes.
- Verify visually in the target runtime when practical.
```

For API or behavior-sensitive work, add:

```md
For API or behavior-sensitive changes:

- Do not rename exported functions, components, files, props, persisted keys, test fixtures, endpoints, IPC channels, or public contracts unless explicitly approved.
- Do not combine unrelated behavior changes in one pass.
```

---

### Required First Pass

Default version:

```md
## Required First Pass

Before implementation, Codex must:

- Inspect the relevant project structure.
- Ensure the repository has a `.gitignore`; if it is missing, create one before implementation.
- Identify existing conventions, dependencies, tests, scripts, and verification commands.
- Identify currently visible bugs or diagnostics related to the selected work before editing code.
- Confirm whether this checklist is stale, incomplete, or too broad.
- Split oversized checklist items before implementation.
- Update this file only if the checklist materially needs correction.
- Do not add reconnaissance notes unless they record a blocker, user approval, or durable decision.
```

For UI/refactor work, add domain-specific inspection targets.

---

### Implementation Phases

Use phases to organize work.

Rules:

- Phases should be ordered by dependency and risk.
- Each phase should contain small checkboxes.
- Each phase should end with a small `README.md` update checkbox covering the phase's completed behavior, commands, and usage.
- Parent checkboxes remain unchecked until children are complete.
- Do not make a giant checkbox for an entire subsystem.
- Do not scaffold future phases early unless the current checkbox requires it.

Template:

```md
## Implementation Phases

### Phase 1: Project Foundation

- [ ] Create the minimal project scaffold.
  - [ ] Add package scripts.
  - [ ] Add TypeScript configuration.
  - [ ] Add frontend structure.
  - [ ] Add backend structure.
  - [ ] Add README with local commands.
  - [ ] Update README.md with the completed Phase 1 behavior, commands, and usage.

### Phase 2: Core Feature

- [ ] Implement [feature area].
  - [ ] Add [small task].
  - [ ] Add [small task].
  - [ ] Verify [behavior].
  - [ ] Update README.md with the completed Phase 2 behavior, commands, and usage.
```

---

### Scope Inventory

Use this when the project has many affected files, components, services, screens, routes, workflows, or APIs.

Template:

```md
## Scope Inventory

This inventory is a scope map, not an implementation dependency graph. Keep it current as new affected areas are discovered.

- [ ] Area 1.
  - [ ] `file-or-component`
- [ ] Area 2.
  - [ ] `file-or-service`
```

Use inventory to prevent missed work. Do not use it as a substitute for the implementation checklist.

---

### Suggested Execution Order

Use a numbered list, not checkboxes, unless the items are actual executable work.

Template:

```md
## Suggested Execution Order

1. Foundations and setup verification.
2. First safe pilot.
3. Expand by proven pattern.
4. Integrate the main workflow.
5. Add verification and polish.
6. Final cleanup.
```

---

### Verification Guidance

Default version:

```md
## Verification Guidance

Use the repo's actual scripts once they exist.

Expected verification path:

- `npm run typecheck`
- `npm test` or the closest available focused test command
- `npm run build`
- manual runtime verification of the main workflow when applicable

Active bug gate:

- Before finishing, rerun the most relevant diagnostics for the changed code path.
- Treat any active bug, failing diagnostic, failing test, build failure, runtime exception, or obvious console error in the changed path as a blocker.
- Do not mark work complete while active bugs remain unless the bug is clearly unrelated pre-existing behavior; in that case, document it as `GOAL_BLOCKED` or add a durable blocker rather than silently finishing.

Until scripts exist, each implementation step should include the smallest practical verification for the files changed.

Do not mark a checkbox complete unless its behavior has been implemented and verified.
```

Only include commands that are valid or clearly expected for the project.

---

### Blocked Status Handling

Default version:

```md
## Blocked Status Handling

- Codex should report blocked runs in its response as `GOAL_BLOCKED` with the exact reason.
- Codex should not persist `GOAL_BLOCKED` into `goal.md` by default.
- A persistent `GOAL_BLOCKED` marker may be added to `goal.md` only when the user explicitly asks for persistent blocked status.
- `GOAL_COMPLETE` may be added to `goal.md` only when every required checkbox is complete and verification passes.
```

---

### Completion Markers

Default version:

```md
## Completion Markers

Add exactly one of these markers only when appropriate:

- `GOAL_COMPLETE` when every required checkbox is complete and verification passes.
- `GOAL_BLOCKED` only when the user explicitly asks Codex to persist blocked status in `goal.md`.
```

---

## Checklist Quality Rules

When generating checklist items:

- Make each item independently verifiable.
- Prefer small, behavior-based tasks over broad category labels.
- Split oversized work before implementation.
- Avoid vague verbs such as "improve", "clean up", "fix stuff", or "handle everything".
- Use parent checkboxes only as grouping containers.
- Keep parent checkboxes unchecked until all children are complete.
- Avoid marking strategic guidance as checkboxes.
- Keep suggested order as a numbered list unless it is executable work.
- Do not duplicate the same work in both the checklist and inventory.

---

## Default Codex Repeat Prompt

After `goal.md` exists, use this prompt repeatedly:

```txt
Use `goal.md` as the source of truth.

Complete the next smallest safe unchecked checkbox/sub-checkbox according to the rules in `goal.md`.

Update only that checkbox in `goal.md`.

Run the relevant verification command.

Report:
- completed checkbox
- changed files
- verification run
- whether `goal.md` was updated

Before finishing, rerun relevant diagnostics for the changed path. If active bugs remain, say `GOAL_BLOCKED` with the reason instead of reporting completion.

If complete, say `GOAL_COMPLETE`.

If blocked, say `GOAL_BLOCKED` with the reason and do not persist the marker unless explicitly instructed.
```

---

## Prompt To Create A New `goal.md`

Use this when starting a new program:

```txt
Create a Codex-ready `goal.md` for this project using the Goal Runner Framework.

The `goal.md` should be a durable execution control document, not a progress journal.

Include:
- product goal
- durable control-file rule if relevant
- in-scope and out-of-scope boundaries
- product shape or workflow shape
- stop conditions if the project includes loops or automation
- safety rules
- future Codex run discipline
- file hygiene rules
- definition of done
- required first pass
- implementation phases with small checkboxes
- scope inventory if useful
- suggested execution order
- verification guidance
- an active-bug gate that prevents completion while unresolved bugs or diagnostics remain
- blocked status handling
- completion markers

Make each checklist item small enough for one safe Codex pass. If any item is too broad, split it before writing the final checklist.
```

---

## Prompt To Refine An Existing `goal.md`

Use this when a `goal.md` already exists:

```txt
Refine the existing `goal.md` using the Goal Runner Framework.

Keep what is useful. Remove bloat. Preserve project-specific constraints.

Make sure the result:
- keeps `goal.md` as the source of truth
- has clear in-scope and out-of-scope boundaries
- has future Codex run discipline
- has file hygiene rules
- has verification guidance
- has an active-bug gate that prevents completion while unresolved bugs or diagnostics remain
- has blocked status handling
- has completion marker rules
- uses small, independently verifiable checkboxes
- does not contain progress-journal notes or reasoning traces
- does not rewrite unrelated completed work unless required for clarity

Do not implement project code. Only repair the control document.
```

---

## Prompt To Repair A Bloated Or Stale `goal.md`

Use this when `goal.md` has become too long, stale, repetitive, or ambiguous:

```txt
Repair `goal.md` as a concise Codex execution control document using the Goal Runner Framework.

Do not implement code.

Your job is to:
- preserve the true project goal
- preserve durable decisions and blockers
- remove progress-journal clutter
- merge duplicate rules
- split oversized checklist items
- make checklist items independently verifiable
- add or preserve an active-bug gate that prevents completion while unresolved bugs or diagnostics remain
- preserve completed checkbox state when clearly valid
- avoid changing completed state when uncertain
- keep scope boundaries explicit
- keep verification and completion marker rules clear

Report what structural changes were made.
```

---

## Final Quality Check

Before returning a generated or refined `goal.md`, verify that:

- `goal.md` has a clear product or implementation goal.
- The target repository has a `.gitignore`, or the generated `goal.md` requires creating one before implementation.
- Scope boundaries are explicit.
- Future Codex run discipline exists.
- File hygiene rules exist.
- Definition of done exists.
- Verification guidance exists.
- Stop conditions exist if the workflow has loops or automation.
- Blocked handling exists.
- Completion markers are defined.
- Checklist items are small enough for safe repeated Codex runs.
- The file does not read like a progress journal.
- The file does not invite Codex to perform multiple unrelated tasks in one pass.
- The file does not allow silent scope expansion.
- The file contains an active-bug gate that prevents completion while unresolved bugs, diagnostics, failing tests, build failures, runtime exceptions, or relevant console errors remain.
