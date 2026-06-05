---

name: goal-runner-framework
description: Create, repair, or refine concise goal.md files for Agent-driven multi-pass implementation work. Use only for durable Agent source-of-truth control documents with scope boundaries, execution discipline, verification guidance, blocked handling, checklist quality, and completion marker policy. Do not use for implementing project code or running checklist items.
--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

# Goal Runner Framework Skill

## Purpose

Use this skill to create, repair, or refine a `goal.md` file for Agent-driven implementation work.

A strong `goal.md` is a concise execution control document. It should give Agent enough durable direction to complete repeated implementation passes safely without becoming a progress journal, design essay, or duplicate instruction manual.

The default output should be short, checklist-driven, and stable across many Agent runs.

---

## Core Principle

`goal.md` is the tactical source of truth.

It should define:

* the goal,
* scope boundaries,
* execution rules,
* verification expectations,
* stop or blocked conditions,
* completion marker policy,
* small implementation checkboxes.

It should not repeat every durable rule in full if that rule already belongs in `AGENTS.md` or another repo-level instruction file.

---

## Token Discipline

Optimize generated `goal.md` files for repeated Agent use.

Rules:

* Prefer short sections over long explanations.
* Prefer compact checklists over paragraphs.
* Do not duplicate the same rule in multiple sections.
* Do not include implementation history, progress summaries, reasoning traces, or routine observations.
* Do not include long examples inside `goal.md`.
* Do not repeat generic Agent behavior in every phase.
* Put durable repo-wide behavior in `AGENTS.md` when possible.
* Put tactical project work in `goal.md`.
* Keep verification guidance centralized.
* Keep blocked/completion marker rules centralized.
* Use placeholders only when the missing detail materially affects implementation.

A good `goal.md` should be compact enough to be re-read every run without wasting context.

---

## When To Use This Skill

Use this skill when the user asks to:

* create a new `goal.md`,
* refine an existing `goal.md`,
* repair a bloated, stale, or ambiguous `goal.md`,
* convert a project idea into a Agent-ready implementation plan,
* create a durable control file for repeated Agent runs,
* improve checklist quality, verification discipline, or blocked handling.

Do not use this skill for ordinary one-off coding tasks.

---

## Information To Gather Or Infer

Gather only what is needed to write or repair `goal.md`:

* project name,
* desired end state,
* current stack,
* target runtime,
* in-scope work,
* out-of-scope work,
* approval requirements,
* dependency restrictions,
* behavior-preservation requirements,
* verification commands,
* implementation phases,
* affected areas,
* known blockers,
* completion marker policy.

If information is missing, make conservative assumptions and mark only material unknowns as placeholders. Do not invent risky implementation details.

---

## Default `goal.md` Structure

Use this compact structure by default:

```md
# [Project Name] Goal

## Goal

## Scope

### In Scope

### Out of Scope

## Execution Rules

## Implementation Plan

## Verification

## Blocked / Complete Policy

## Durable Notes
```

Only add extra sections when they materially improve execution.

Optional sections:

```md
## Product Shape
## Stop Conditions
## Safety Rules
## Scope Inventory
## Suggested Execution Order
```

Do not include optional sections by habit.

---

## Section Rules

### Goal

State the desired end state briefly.

Use 1–3 short paragraphs.

Include:

* what is being built or changed,
* the intended user/workflow,
* the MVP completion target.

Avoid long product essays.

---

### Scope

Use explicit in-scope and out-of-scope lists.

Rules:

* In-scope items define the MVP or implementation boundary.
* Out-of-scope items prevent scope creep.
* Do not include generic exclusions unless they matter.

Template:

```md
## Scope

### In Scope

- [Required feature or behavior]
- [Required workflow]
- [Required technical boundary]

### Out of Scope

- [Excluded feature]
- [Excluded integration]
- [Excluded redesign or runtime]
```

---

### Execution Rules

Keep this section short. It should control future Agent runs without repeating the whole skill.

Default version:

```md
## Execution Rules

- Use this `goal.md` as the source of truth.
- Complete the next valid unchecked item only.
- A valid item is the first unchecked checkbox whose dependencies are complete and whose work can be safely completed in one focused pass.
- Do not broaden scope beyond the selected checkbox.
- Do not scaffold future phases unless required by the selected checkbox.
- Keep each change independently verifiable.
- Update only the relevant checkbox state after verified completion.
- Do not add run logs, reasoning traces, or routine progress notes to this file.
- Split oversized checklist items before implementing them.
```

Add project-specific execution rules only when required.

For dependency installs:

```md
- Before running install/download commands, request approval and state what will be installed.
```

For behavior-sensitive work:

```md
- Do not rename public APIs, persisted keys, routes, IPC channels, exported functions, props, or files unless explicitly required by the selected item.
```

For UI work:

```md
- Preserve existing behavior unless the selected item explicitly changes it.
```

---

### Implementation Plan

Use phases only when they help ordering.

Rules:

* Each checkbox should be small enough for one Agent pass.
* Prefer behavior-based tasks.
* Parent checkboxes are grouping containers.
* Parent checkboxes remain unchecked until children are complete.
* Do not duplicate the same work in inventory and checklist.
* Avoid vague verbs like “improve,” “clean up,” “handle,” or “fix everything.”
* Avoid large subsystem checkboxes.

Compact template:

```md
## Implementation Plan

### Phase 1: [Foundation]

- [ ] [Small independently verifiable task]
- [ ] [Small independently verifiable task]
- [ ] [Focused verification or documentation task if needed]

### Phase 2: [Core Workflow]

- [ ] [Small independently verifiable task]
- [ ] [Small independently verifiable task]
- [ ] [Focused verification or documentation task if needed]
```

Do not add a README update checkbox to every phase unless documentation is actually part of the project requirement.

---

### Verification

Keep verification centralized and concise.

Default version:

```md
## Verification

Use the narrowest verification that proves the selected checkbox.

Expected commands, once available:

- `npm run typecheck`
- `npm test` or the closest focused test command
- `npm run lint`
- `npm run build`

Do not mark a checkbox complete if the changed path has active test failures, type errors, lint errors, build failures, runtime exceptions, or relevant console errors.

Run broader verification at phase boundaries or before `GOAL_COMPLETE`.
```

Only include commands that are valid or clearly expected for the project.

If the repo has no scripts yet:

```md
Until scripts exist, verify with the smallest practical command or manual check for the changed files.
```

---

### Blocked / Complete Policy

Use this centralized version:

```md
## Blocked / Complete Policy

- Report blocked runs as `GOAL_BLOCKED` with the exact reason.
- Do not persist `GOAL_BLOCKED` in this file unless the user explicitly asks.
- Add `GOAL_COMPLETE` only when every required checkbox is complete and final verification passes.
- Do not add completion markers during ordinary intermediate runs.
```

Do not repeat this policy elsewhere.

---

### Durable Notes

Use this only for decisions, approvals, blockers, or constraints that future Agent runs must know.

Template:

```md
## Durable Notes

- [Decision, approval, blocker, or constraint that materially affects future runs.]
```

Rules:

* Keep notes short.
* Do not record routine progress.
* Delete stale notes when no longer relevant.
* If a note will not matter to a future run, do not write it.

---

## Optional Sections

### Product Shape

Use only for UI, CLI, API, or workflow-heavy projects.

Keep it compact.

```md
## Product Shape

- Primary surface: [UI / CLI / API / local workflow]
- Main workflow: [short description]
- UX priority: [speed / clarity / safety / observability]
```

Avoid detailed layout unless the user asked for design control.

---

### Stop Conditions

Use only for loops, automation, agents, long-running processes, or repeated command execution.

```md
## Stop Conditions

Stop when:

- the selected command fails,
- verification fails,
- the user stops the run,
- the configured run count is reached,
- `goal.md` contains `GOAL_COMPLETE`,
- `goal.md` contains `GOAL_BLOCKED`,
- required inputs are invalid or missing.
```

---

### Safety Rules

Use only when the project needs explicit risk controls.

Default examples:

```md
## Safety Rules

- Do not request, store, or expose credentials unless explicitly required and approved.
- Do not run commands outside the selected working directory.
- Validate user-provided paths and request bodies before use.
- Avoid shell-concatenated command strings where argument arrays are practical.
- Do not add telemetry unless explicitly approved.
- Keep logs local unless the user explicitly approves otherwise.
```

Keep this section project-specific. Do not include irrelevant safety rules.

---

### Scope Inventory

Use only when many files, components, routes, services, screens, or workflows may be affected.

Rules:

* This is a scope map, not a duplicate checklist.
* Keep it short.
* Do not mark inventory items as implementation tasks unless they are actual work.

Template:

```md
## Scope Inventory

- `path/or/area`: [why it matters]
- `path/or/area`: [why it matters]
```

---

### Suggested Execution Order

Use only when order is not obvious from the checklist.

Use a numbered list, not checkboxes.

```md
## Suggested Execution Order

1. Validate current structure and scripts.
2. Complete the first safe foundation task.
3. Expand by proven pattern.
4. Integrate the main workflow.
5. Run final verification.
```

---

## Checklist Quality Rules

When generating checklist items:

* Make each item independently verifiable.
* Make each item small enough for one safe Agent pass.
* Prefer concrete behavior over broad categories.
* Split oversized work before implementation.
* Use parent items only as grouping containers.
* Keep parent items unchecked until children are complete.
* Avoid strategic guidance as checkboxes.
* Avoid duplicate work across sections.
* Avoid low-value documentation checkboxes unless documentation is part of completion.

Good:

```md
- [ ] Validate selected repository paths.
- [ ] Reject missing paths with a user-visible error.
- [ ] Reject non-git directories.
- [ ] Add focused tests for repository path validation.
```

Bad:

```md
- [ ] Improve repository handling.
- [ ] Clean up validation.
- [ ] Make everything robust.
```

---

## Invocation Modes

Use one of these modes based on the user's request:

- **Create**: create a new concise `goal.md` from a project idea or repository.
- **Refine**: improve an existing mostly-valid `goal.md` while preserving its intent and completed checkbox state.
- **Repair**: aggressively compress a bloated, stale, repetitive, or ambiguous `goal.md`.

In all modes:

- optimize for low repeated-token usage,
- keep `goal.md` as the tactical source of truth,
- preserve durable project constraints,
- use small independently verifiable checkboxes,
- centralize verification and completion marker rules,
- do not implement project code.


## Final Quality Check

Before returning a generated or refined `goal.md`, verify that:

* the goal is clear,
* scope boundaries are explicit,
* execution rules are compact,
* verification guidance exists,
* blocked and completion marker rules exist,
* checklist items are small enough for repeated Agent runs,
* optional sections are included only when useful,
* rules are not duplicated across sections,
* the file does not read like a progress journal,
* the file does not invite multiple unrelated tasks in one pass,
* the file does not allow silent scope expansion.
