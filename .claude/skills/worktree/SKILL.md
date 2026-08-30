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

A fresh worktree has none of the git-ignored files the services need. **Run these next, before any other work** — every service reads `.env` from the repo root, and without `node_modules` the lint and test commands will not run. Run only the installs the task's service needs:

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

Commit message format: a one-line summary starting with `<service>: ` or `<feature>: `. No other body text. A "Co-Authored by Claude" message is allowed.

> **Worktree tooling note:** this session's Bash tool refuses heredocs and multi-part commands with redirects while worktree-isolated. Use the Write/Edit tools for file creation, and keep shell commands simple.
