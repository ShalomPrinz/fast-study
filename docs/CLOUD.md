# Cloud sessions

A Claude Code cloud session (`CLAUDE_CODE_REMOTE=true`) runs in a throwaway container, so work that is
not pushed is lost when the session ends. The rules below override the matching rules in the root
[`CLAUDE.md`](../CLAUDE.md) and its skills for cloud sessions only; every other rule still holds.

## Branch and push

- Work on a branch named `claude/<task-slug>`, where the slug is a short kebab-case name for the task.
  If the session starts on another branch, create this one from the current `HEAD` with
  `git switch -c claude/<task-slug>`. That is the only branch command allowed.
- Push every commit to that branch: `git push -u origin claude/<task-slug>`. Commits still follow the
  [`git-commit`](../.claude/skills/git-commit/SKILL.md) skill, `reviewer` included.
- Never push to `main`, never force-push, and never push any other branch.

## Formatting

The container has no install of the repo's prettier, so the format hook formats only Python and
reports that it skipped prettier. That is expected; do not install or run any other prettier. The
`Format` workflow checks every push to `claude/*`. A failing run gets fixed in a local session before
the branch merges.
