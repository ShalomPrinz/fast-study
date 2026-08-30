---
description: Turn one task — the first in TODOS.md, or the one given as an argument — into a well-planned prompt file ready for implementation.
argument-hint: [optional task description]
---

This command plans **exactly one task**. Everything below is scoped to that single task.

## Picking the task

- **If arguments were passed to this command** (e.g. `/plan-tasks fix that bug in this file`), that text _is_ the task. Do **not** read `TODOS.md` at all — ignore it entirely for this run.
- **Otherwise**, read `TODOS.md` from the project root in full, then work only on the **first task listed there**. Reading the whole file is for context — so you understand what the first task does and does not cover, and what belongs to later tasks — not for planning the rest.
  - If `TODOS.md` does not exist or is empty, tell the user there are no tasks there and stop.

One task can still yield several prompt files, but every one of them must serve that same task. Never plan a prompt for a later `TODOS.md` item.

---

## Step 1 — Understand

Read `CLAUDE.md`.

Work out exactly what the task asks for and where in the codebase it lands. Identify whether it is one coherent change or several distinct changes that happen to be written as one item — a "distinct change" is anything that:

- Touches a different part of the codebase than another part of the task
- Has a different type (bug fix vs feature vs refactor)
- Would produce a cleaner, more focused prompt on its own

---

## Step 2 — Clarify

Before generating anything, decide whether the task is ambiguous, underspecified, or has more than one reasonable interpretation. If so, ask a single focused question per open point. Do not ask about things you can infer from the codebase or from CLAUDE.md.

If the user asked for worktree mode (see **Worktree mode** below) and the plan from Step 3 has more than one prompt, ask here which of them should get the worktree section — one question listing the prompts, not one question per prompt.

Wait for the user's answers before continuing.

---

## Step 3 — Plan

Decide whether this task needs one prompt or several. Each prompt should be:

- Focused on one coherent change
- Executable independently without depending on another prompt in the same batch (unless you explicitly mark a dependency, then ask the user what he prefers to do)
- Small enough that Claude Code can hold the full context in one session

Default to a single prompt. Split into more only when the task genuinely touches multiple unrelated areas.

---

## Worktree mode

Off by default. It turns on only when the user says **"use worktree"** (or asks for one in other words) for this run. When it is on:

- One prompt in the plan → that prompt gets the section.
- More than one → ask in Step 2 which ones get it; only those do.

The rules themselves live in the `worktree` skill, which also defines the slug naming convention. Each worktree-enabled prompt gets its own slug.

Emit this section into the prompt file, with `<slug>` replaced:

```
### Where the work lives — read before anything else

Invoke the `worktree` skill and follow it before reading further or touching any file. Your slug for this task is `<slug>`.
```

---

## Step 4 — Generate

For each prompt, create a markdown file in the project root named:

`prompt-[descriptive-kebab-case-name].md`

The name must describe what the prompt does, not its order or type. It should be specific enough that you can tell what it touches without opening the file. Examples of good names: `prompt-fix-end-date-reactivity.md`, `prompt-warrior-notes-field.md`, `prompt-drag-overlay-position.md`. Examples of bad names: `prompt-001.md`, `prompt-feature.md`, `prompt-update.md`.

If two prompts must be executed in order, note the dependency inside the file under **Depends on** — do not encode order in the filename.

Each file must follow this structure exactly:

---

## [Short descriptive and meaningful title]

**Type:** Feature | Bugfix | Refactor | UI | Infrastructure | Tests
(Optional) **Depends on:** [prompt file name]

(Only in worktree mode) The **Where the work lives** section, placed here — above **User Raw Description**, so it is the first thing read.

**User Raw Description:**

> Copy verbatim the exact text of the task — from `TODOS.md`, or the argument text the user passed to this command. Do not paraphrase. If the task was split across several prompts, include the part of the text this prompt addresses.

**Context:**

> What currently exists in the codebase that this prompt touches. Be specific: name the files, components, functions, and data structures involved. Claude Code must be able to understand the starting state from this paragraph alone without reading the whole codebase.

**Goal:**
One sentence. The end state after this prompt is executed.

**Implementation Notes:**

> Step-by-step instructions. Reference file paths explicitly. Call out which existing logic to reuse vs replace. Flag any constraint from CONVENTIONS.md or ERRORS.md that is directly relevant to this change. Do not repeat the full convention — just name it and say why it applies here.

(Optional) **Out of Scope:**

> Anything the user mentioned or implied that should NOT be done in this prompt. Explicit boundaries prevent Claude Code from over-reaching. Anything belonging to a later `TODOS.md` task is out of scope by definition.

**Deliverables:**

- Bullet list of concrete outcomes that must be true when this prompt is complete
- If new logic implemented - test it
- Always ends with running tests (depends on programming language and context of current task)

---

After writing the file(s), print a summary table:

| File | Type | Depends on | One-line summary |
| ---- | ---- | ---------- | ---------------- |

Then stop. Do not execute any of the prompts, and do not plan any further task.
