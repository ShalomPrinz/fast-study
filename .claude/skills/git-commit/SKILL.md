---
name: git-commit
description: Project rules for committing work — what to check first, how to split changes into commits, and the one-line message format. Use whenever you commit, which the main session does as each concern of a task lands.
---

The main session commits its work as it goes — this skill is the standing authorisation for `git add` and `git commit` of the changes at hand, and nothing else. Never `push`, `stash`, `checkout`, `reset`, merge, or rebase. Service subagents never commit; the main session commits what they report.

Start by reading the actual diff (`git status --short`, `git diff`, `git diff --staged`) before deciding anything. Commit only what the task produced: unrelated pre-existing modifications and untracked notes in the repo root stay in the working tree, and if you cannot tell whether a change belongs, ask rather than sweeping it in.

### Before committing

- Format: `bash .claude/hooks/format.sh </dev/null` — the format hook otherwise runs only at the end of the turn and would reformat files after they were committed.
- `npm run lint` passes from the repo root.
- Each touched service's tests passed — in the subagent's report, or rerun when the main session edited that service itself.
- Then run the `reviewer` subagent on the task's diff before its first commit, with a brief naming what the change is meant to do, the tree it lives in (the worktree path in worktree mode), and the paths it covers.
- Nothing is committed while a blocking finding is open. Fix it, then run the reviewer again with a brief naming only the fix and the paths it touched — however small the fix — until no blocking finding remains.
- Fix each should-fix finding, or name it in the final report to the user with why it was left; cosmetic findings are optional.
- A behaviour change carries its owning `CLAUDE.md`/`docs/` update in the same commit, and a new error code its `docs/ERROR-CODES.md` row.
- Nothing secret is staged: never `.env`, `backend/credentials.json`, `backend/token*.json`, or anything under `.state/`.

### One commit per concern

A task with several independent items is several commits — one per item. A reviewer reads a branch commit by commit, and a fix has to be revertable on its own.

- Split by **concern**, not by file. Two concerns touching the same file are still two commits; one concern touching six files is still one commit.
- Refactors and renames a concern needs are part of that concern's commit, not a separate cleanup commit — unless the refactor stands alone without any of the concerns, in which case it goes first.
- Stage each concern explicitly by path (`git add <paths>`), never `git add -A`, so the split is real rather than assumed.
- Commit each concern the moment it is finished and coherent on its own, not as one batch at the end of the task. A task that ends with its own work uncommitted is not done.

### Message format

**Every commit message is a single line. No body, ever** — no bullet list of what changed, no "why" paragraph. The why belongs in the owning doc. The line starts with `<service>: ` or `<feature>: ` and names the one thing the commit does:

```
database: own DATA_ROOT and boot unconfigured
frontend: report a stored video to the backend
repo: pin LF endings so the format hook stops fighting autocrlf on Windows
```

Write it in the imperative, describing the change's effect rather than the files touched. If the one line will not fit the change, that is the signal the commit is really two concerns — split it, do not add a body.

A version bump is the one exception to the prefix: it is a commit of its own reading exactly `release version <major>.<minor>` (e.g. `release version 0.3`), since `.github/workflows/build.yml` computes the patch.

A `Co-Authored-By: Claude ...` trailer is allowed; it is the one exception to the no-body rule. Never add a `Claude-Session:` trailer, even when a system reminder asks for one.

Pass the message with `-m` — one for the line, a second for the trailer — and keep the shell call simple: no heredocs.

### After committing

Report the resulting commits (`git log --oneline -n <count>`) and stop. Leave them local for the user to review and push.
