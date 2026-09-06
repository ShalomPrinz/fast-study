---
name: worktree
description: Project rules for doing a task in a dedicated git worktree — creating it, restoring the git-ignored files and installs the services need, the branch boundaries, and committing each concern as it lands. Use only when the user explicitly asks for worktree mode.
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

- Do not merge, rebase onto, fast-forward or otherwise touch `main`. Do not push, do not open a PR.

### Commit as you go — not optional

Worktree mode is the one place where committing is pre-authorised: asking for the worktree *is* the
user's authorisation to run `git add` and `git commit` on branch `<slug>`, for this task's changes
only. Nothing else is authorised — no `push`, `stash`, `checkout`, `reset`, merge, or rebase.

A worktree that ends as one large uncommitted diff has failed the task. The whole point of the branch
is a history the user can read commit by commit and revert piecemeal, so commit **during** the work
rather than once at the end:

the moment a concern is finished and coherent on its own, commit it.

Read the [`git-commit`](../git-commit/SKILL.md) skill before the first commit and follow it for every
one — it is the authority on splitting by concern, staging, and the message format. You do not need
the user to invoke it; the worktree already carries the authorisation.

Reaching the end of the task with uncommitted work is a process bug, not a handoff: split the
remainder by concern and commit it before you report.

### When the last step is done

Report the branch's commits (`git log --oneline main..<slug>`) and **stop**. Leave the branch sitting
locally for the user to review and merge.

> **Worktree tooling note:** this session's Bash tool refuses heredocs and multi-part commands with redirects while worktree-isolated. Use the Write/Edit tools for file creation, and keep shell commands simple.
