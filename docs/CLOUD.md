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
- Each push to that branch runs `build.yml` (build + smoke). With no `gh`, read the results from the public
  API (`curl -s "https://api.github.com/repos/ShalomPrinz/fast-study/actions/runs?branch=<branch>"`); logs need auth.

## Screenshots

The container's scratchpad is not on the user's machine, so a screenshot left there is never seen.
Send each screenshot to the user with `SendUserFile`, full window as always, and never commit it.

## Environment

Three settings prepare a container; none of them acts locally.

- **Setup script**: [`.claude/cloud/setup.sh`](../.claude/cloud/setup.sh), pasted into the cloud
  environment's "Setup script" at claude.ai/code. It installs tectonic and warms its LaTeX bundle,
  and the snapshot caches both for about a week. Paste it again whenever the file changes.
- **Network access**: Custom, with the defaults kept, plus `relay.fullyjustified.net` and
  `data1b.fullyjustified.net`, which serve tectonic's bundle. Without them every PDF step fails.
- **SessionStart hook**: [`.claude/hooks/cloud-install.sh`](../.claude/hooks/cloud-install.sh) runs
  `npm ci` at the root, in `frontend/` and in `downloader/`, and `uv sync` in `backend/` and
  `database/`. It skips an `npm ci` whose lockfile is unchanged. A failed install is named in the
  session's first context; it does not stop the session.

## Formatting

The hook installs the lockfile's prettier, so formatting matches a local session. If that install
failed, the format hook skips prettier and says so; never run another prettier in its place. The
`Format` workflow checks every push to `claude/*` as a backstop.
