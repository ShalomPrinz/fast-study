---
name: worktree
description: Project rules for doing a task in a dedicated git worktree — creating it, restoring the git-ignored files and installs the services need, and the branch/commit boundaries. Use only when the user explicitly asks for worktree mode.
---

Substitute `<slug>` throughout and take `<repo-root>` from the actual project root.

Pick a short `snake_case` topic slug naming the change (`support_i18n`, `unknown_url_modules`) — not a file name. It names both the branch and the worktree directory.

### Where the work lives — read before anything else

All work happens in a git worktree dedicated to this task. **Create it first, before reading further or touching any file:**

```
git -C <repo-root> worktree add -b <slug> <repo-root>-<slug> main
```

Then run every command from **`<repo-root>-<slug>`**, on the local branch **`<slug>`**. Do not `cd` to `<repo-root>` — it stays on `main`, untouched.

Next, add `<repo-root>-<slug>` to the `permissions.additionalDirectories` array in `<repo-root>/.claude/settings.local.json` (the session's project settings — the worktree has no copy of its own, that file is git-ignored). Without it every `cd` and search into the new directory reads as out-of-scope and prompts. Use Edit, not a shell heredoc — see the tooling note at the end.

A fresh worktree has none of the git-ignored files the services need. **Run all of these next, before any
other work** — every line, whether or not the task touches that service. Deciding which installs a change
"needs" is not yours to make: a worktree the app cannot be run from is not set up.

```
cp <repo-root>/.env <repo-root>-<slug>/.env
cd <repo-root>-<slug> && npm install
cd <repo-root>-<slug>/frontend && npm install
cd <repo-root>-<slug>/downloader/server && npm install
cd <repo-root>-<slug>/downloader/auto && npm install
```

- Commits are authorised **only** on this branch and **only** for this task.
- Do not merge, rebase onto, fast-forward or otherwise touch `main`. Do not push, do not open a PR.
- When the last step is done, **stop**. Leave the branch sitting locally for the user to review and merge.
- If the work has to be abandoned mid-way, leave the branch as-is and report; do not reset or delete it.

### One commit per concern

A task with several independent items is several commits — one per item. A reviewer reads a branch commit by commit, and a fix has to be revertable on its own.

- Split by **concern**, not by file. Two concerns touching the same file are still two commits; one concern touching six files is still one commit.
- Refactors and renames a concern needs are part of that concern's commit, not a separate cleanup commit — unless the refactor stands alone without any of the concerns, in which case it goes first.

Commit message format: a one-line summary starting with `<service>: ` or `<feature>: `, naming the one thing that commit does. No other body text. A "Co-Authored by Claude" message is allowed.

> **Worktree tooling note:** this session's Bash tool refuses heredocs and multi-part commands with redirects while worktree-isolated. Use the Write/Edit tools for file creation, and keep shell commands simple.
