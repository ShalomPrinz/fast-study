---
description: Turn TODOS.md into per-task prompt files ready for /implement.
---

Read `TODOS.md` from the project root.

If `TODOS.md` does not exist or is empty, tell the user there are no tasks there and stop.

---

## Step 1 — Understand

Read `CLAUDE.md` to ground yourself in the current state of the codebase before interpreting the todos.

Parse `TODOS.md` and identify each distinct change the user wants. A "distinct change" is anything that:

- Touches a different part of the codebase than another item
- Has a different type (bug fix vs feature vs refactor)
- Would produce a cleaner, more focused prompt on its own

---

## Step 2 — Clarify

Before generating anything, identify any todo that is ambiguous, underspecified, or has more than one reasonable interpretation. For each one, ask a single focused question. Do not ask about things you can infer from the codebase or from CLAUDE.md.

If the user asked for worktree mode (see **Worktree mode** below) and the plan from Step 3 has more than one prompt, ask here which of them should get the worktree section — one question listing the prompts, not one question per prompt.

Wait for the user's answers before continuing.

---

## Step 3 — Plan

Decide how to split the todos into prompts. Each prompt should be:

- Focused on one coherent change
- Executable independently without depending on another prompt in the same batch (unless you explicitly mark a dependency, then ask the user what he prefers to do)
- Small enough that Claude Code can hold the full context in one session

Group related small items together. Split large items that touch multiple unrelated areas.

---

## Worktree mode

Off by default. It turns on only when the user says **"use worktree"** (or asks for one in other words) for this run. When it is on:

- One prompt in the plan → that prompt gets the section.
- More than one → ask in Step 2 which ones get it; only those do.

Pick a short `snake_case` topic slug per prompt naming the change (`support_i18n`, `unknown_url_modules`) — not the full prompt file name. Each worktree-enabled prompt gets its own slug.

Emit this section verbatim into the prompt file with `<slug>` replaced throughout, and the repo root path taken from the actual project root. Drop the `npm install` lines the prompt's service does not need.

````
### Where the work lives — read before anything else

All work happens in a git worktree dedicated to this task. **Create it first, before reading further or touching any file:**

```
git -C <repo-root> worktree add -b <slug> <repo-root>-<slug> main
```

Then run every command from **`<repo-root>-<slug>`**, on the local branch **`<slug>`**. Do not `cd` to `<repo-root>` — it stays on `main`, untouched.

A fresh worktree has none of the git-ignored files the services need. **Run these next, before any other work** — every service reads `.env` from the repo root, and without `node_modules` the lint and test commands will not run:

```
cp <repo-root>/.env <repo-root>-<slug>/.env
cd <repo-root>-<slug> && npm install
cd <repo-root>-<slug>/frontend && npm install
```

- Commits are authorised **only** on this branch and **only** for this task.
- Do not merge, rebase onto, fast-forward or otherwise touch `main`. Do not push, do not open a PR.
- When the last step is done, **stop**. Leave the branch sitting locally for the user to review and merge.
- If the work has to be abandoned mid-way, leave the branch as-is and report; do not reset or delete it.

Commit message format: a one-line summary starting with `<service>: ` or `<feature>: `. No other body text.

> **Worktree tooling note:** this session's Bash tool refuses heredocs and multi-part commands with redirects while worktree-isolated. Use the Write/Edit tools for file creation, and keep shell commands simple.
````

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

> Copy verbatim the exact text from TODOS.md that this prompt addresses. Do not paraphrase. If multiple todo items are grouped into this prompt, include all of them.

**Context:**

> What currently exists in the codebase that this prompt touches. Be specific: name the files, components, functions, and data structures involved. Claude Code must be able to understand the starting state from this paragraph alone without reading the whole codebase.

**Goal:**
One sentence. The end state after this prompt is executed.

**Implementation Notes:**

> Step-by-step instructions. Reference file paths explicitly. Call out which existing logic to reuse vs replace. Flag any constraint from CONVENTIONS.md or ERRORS.md that is directly relevant to this change. Do not repeat the full convention — just name it and say why it applies here.

(Optional) **Out of Scope:**

> Anything the user mentioned or implied that should NOT be done in this prompt. Explicit boundaries prevent Claude Code from over-reaching.

**Deliverables:**

- Bullet list of concrete outcomes that must be true when this prompt is complete
- If new logic implemented - test it
- Always ends with running tests (depends on programming language and context of current task)

---

After writing all files, print a summary table:

| File | Type | Depends on | One-line summary |
| ---- | ---- | ---------- | ---------------- |

Then stop. Do not execute any of the prompts.
