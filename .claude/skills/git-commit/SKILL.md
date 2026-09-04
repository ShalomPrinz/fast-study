---
name: git-commit
description: Project rules for committing work — how to split changes into commits and the one-line message format. Use when the user asks to commit.
---

Invoking this skill is the user's authorisation to run `git add` and `git commit` for the changes at hand — nothing else. Never `push`, `stash`, `checkout`, `reset`, merge, or rebase.

Start by reading the actual diff (`git status`, `git diff`, `git diff --staged`) before deciding anything. Commit only what the task produced: unrelated pre-existing modifications stay in the working tree, and if you cannot tell whether a change belongs, ask rather than sweeping it in.

### One commit per concern

A task with several independent items is several commits — one per item. A reviewer reads a branch commit by commit, and a fix has to be revertable on its own.

- Split by **concern**, not by file. Two concerns touching the same file are still two commits; one concern touching six files is still one commit.
- Refactors and renames a concern needs are part of that concern's commit, not a separate cleanup commit — unless the refactor stands alone without any of the concerns, in which case it goes first.
- Stage each concern explicitly by path (`git add <paths>`), never `git add -A`, so the split is real rather than assumed.

### Message format

**Every commit message is a single line. No body, ever** — no bullet list of what changed, no "why" paragraph, no trailing blank lines. The line starts with `<service>: ` or `<feature>: ` and names the one thing the commit does:

```
database: own DATA_ROOT and boot unconfigured
frontend: report a stored video to the backend
repo: pin LF endings so the format hook stops fighting autocrlf on Windows
```

Write it in the imperative, describing the change's effect rather than the files touched. If the one line will not fit the change, that is the signal the commit is really two concerns — split it, do not add a body.

A `Co-Authored-By: Claude ...` trailer is allowed; it is the one exception to the no-body rule.

Pass the message with a single `-m`, and keep the shell call simple — no heredocs.

### After committing

Report the resulting commits (`git log --oneline`) and stop. Leave the branch sitting locally for the user to review and merge.
