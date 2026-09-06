---
name: worktree
description: Project rules for doing a task in a dedicated git worktree — creating it, restoring the git-ignored files and installs the services need, and the branch boundaries. Use only when the user explicitly asks for worktree mode.
---

Substitute `<slug>` throughout and take `<repo-root>` from the actual project root.

Pick a short `snake_case` topic slug naming the change (`support_i18n`, `unknown_url_modules`) — not a file name. It names both the branch and the worktree directory.

### Where the work lives — read before anything else

All work happens in a git worktree dedicated to this task. **Create it first, before reading further or touching any file:**

```
bash <repo-root>/.claude/skills/worktree/setup.sh <slug>
```

That one command is the whole setup — there is nothing here for you to decide or check afterwards. It
creates `<repo-root>-<slug>` on a new branch `<slug>` off `main`, restores the git-ignored files the
services need, adds the worktree to `permissions.additionalDirectories` in
`<repo-root>/.claude/settings.local.json` so searching it does not prompt, and runs the four
`npm install`s and both `uv sync --extra test`s.

Then run every command from **`<repo-root>-<slug>`**, on the local branch **`<slug>`**. Do not `cd` to
`<repo-root>` — it stays on `main`, untouched.

- Commits are authorised **only** on this branch and **only** for this task.
- Do not merge, rebase onto, fast-forward or otherwise touch `main`. Do not push, do not open a PR.
- When the last step is done, **stop**. Leave the branch sitting locally for the user to review and merge.
- If the work has to be abandoned mid-way, leave the branch as-is and report; do not reset or delete it.

> **Worktree tooling note:** this session's Bash tool refuses heredocs and multi-part commands with redirects while worktree-isolated. Use the Write/Edit tools for file creation, and keep shell commands simple.
