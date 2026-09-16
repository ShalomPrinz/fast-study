---
name: debug-ci
description: Get the full context of a failed GitHub Actions run — the failing job and step, the error block, the test roster, and the smoke artifact — in one command. Use when the user says CI, a build, a smoke test, or a publish run failed, or names a run id to look at.
---

### Run the script first

Before any `gh` call, any guess, any look at the workflow files:

```
bash <repo-root>/.claude/skills/debug-ci/get_failure_info.sh [<run-id>|<workflow>] --out <scratchpad>/ci
```

With no argument it takes the newest failed run in the repo; with a workflow name (`CI`,
`Build and smoke-test`, `publish`) the newest failure of that workflow. `--out` is optional —
it defaults to `$TMPDIR/faststudy-ci/<run-id>` — but pass your scratchpad so nothing lands near
the repo. It runs from anywhere: it finds the repo itself, because `gh` needs to be inside one.

One run is the whole context. It prints the failing job and step, the `##[error]` lines and the
diagnostic block around the first one, the test roster, the artifact inventory with sizes, and —
for the release smoke job — the failing test's `error-context.md` and the tail of the last app
launch. Do not re-derive any of that with your own `gh` commands; read the digest and answer.

### Read-only, always

This skill never dispatches a workflow, re-runs a job, pushes, or deletes an artifact or a run.
Neither does the script. If the user wants a re-run, say so and let them press the button.

### What the saved paths are for

The digest ends with every file it wrote. Reach for one only when the digest left a question open:

- `logs/<job>-<id>.log` — the whole job log, timestamps and ANSI stripped so it greps cleanly.
  This is the fallback for anything the error block cut off.
- `logs/<job>-error-block.txt` — the printed block, whole, when the digest elided its middle.
- `logs/<job>-roster.txt` — the full test roster when there were too many to print.
- `artifacts/smoke-logs/launch-logs/launch-<n>.log` — one per app launch in the smoke run.
  The highest-numbered one is the failing launch and the digest already tails it; the earlier ones
  tell you what a passing launch looked like.
- `artifacts/smoke-logs/state-logs/launch.log` — the same launch as the app itself wrote it,
  from under the state root.
- `artifacts/smoke-traces/launch-<n>.zip` — Playwright traces, and only with `--all-artifacts`.
  They are 11 MB against the logs' 60 KB and hold nothing the launch logs do not, so the script
  skips them by name; reach for one when a UI assertion failed and you want the DOM snapshot.
  Leave it zipped and open it with `npx playwright show-trace`.

### Artifact sizes

`installer` and `installer-previous` are ~250 MB each and are never what you need — the default
25 MB cap skips them, and the inventory says so out loud. `smoke-traces` is ~11 MB and is skipped
by name, under the cap, because the digest only ever lists it. `smoke-logs` is ~60 KB and comes
down. Pass `--all-artifacts` only if the user explicitly wants an installer or a trace on disk.

A run from before the artifact split has one `smoke-failure` instead, traces inside it; the script
reads either name, so an old run still yields a digest.

### Why the script and not `gh run view`

`gh run view <id> --log-failed` and `gh run view --job <id> --log` come back empty or truncated on
this repo's runs. The job-log REST API (`repos/{repo}/actions/jobs/<id>/logs`) is the path that
works, and the script takes it. Reaching for the convenience command wastes a turn on nothing.

### Then fix it in the owning service

The digest is diagnosis, not a licence to edit. The release smoke suite, the workflows and the
packaged tree belong to `delivery-dev`; a launch failure in the launch logs is usually
`electron-dev`'s; a failing unit test belongs to that service's subagent. Route the fix there.
