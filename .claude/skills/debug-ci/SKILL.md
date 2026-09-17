---
name: debug-ci
description: Use for any first look at GitHub Actions through `gh` — a run's jobs, logs, test roster, artifacts, whether it passed, failed or is still running, and which runs built a commit — including when the user says CI/build/smoke/publish failed or passed, or names a run id.
---

### Run the script first

Before any `gh` call, any guess, any look at the workflow files, run `ci.py` — never raw
`gh run …` or `gh api …actions…`. It is stdlib Python for plain `python3`, runs from anywhere (it
finds the repo itself, because `gh` needs to be inside one), and has three subcommands.

### `runs` — which runs built a commit

```
python3 <repo-root>/.claude/skills/debug-ci/ci.py runs [--workflow W] [--limit N] [--commit REF]
```

One line per recent run: id, workflow, status/conclusion, branch, event, age, sha, subject. `*` marks
a run whose head contains REF (default `HEAD`), so a rebased-then-pushed commit still counts; `?`
means that sha is not fetched locally. It says so plainly when no listed run built REF. `--workflow`
is a case-insensitive substring of the workflow name (`CI`, `Build and smoke-test`, `Publish`).

### `run` — one run, by state

```
python3 <repo-root>/.claude/skills/debug-ci/ci.py run [<id>] [--workflow W] [--failed] --out <scratchpad>/ci
```

No id takes the newest run (of W), `--failed` the newest failed one. The header says whether the
run contains local `HEAD` and `origin/main`; then every job with its failed or cancelled steps. Then:

- **still running or queued** — each job's current step, a snapshot. Run it again for a later one.
- **success** — every job's test roster (Playwright's whole list, a pytest/vitest/node pass
  summary otherwise), then the artifact inventory.
- **failure or cancelled** — the digest: the failing job and step, the `##[error]` lines and the
  diagnostic block around the first one, the roster, annotations, the artifact inventory, and — for
  the release smoke job — the failing test's `error-context.md` and the tail of the last app launch.

`--out` defaults to `$TMPDIR/faststudy-ci/<run-id>`; pass your scratchpad so nothing lands near the
repo. Do not re-derive any of the output with your own `gh` commands; read it and answer.

### `artifacts` — inventory, and a download only on request

```
python3 <repo-root>/.claude/skills/debug-ci/ci.py artifacts <id> [--get NAME ...] [--out D]
```

Names, sizes and expiry. Nothing comes down without `--get`; each named one lands in
`<out>/artifacts/<name>`. Use it when the user wants a specific artifact, such as `installer`, on disk.

### Read-only, always

This skill never dispatches a workflow, re-runs a job, pushes, or deletes an artifact or a run.
Neither does the script. If the user wants a re-run, say so and let them press the button.

### What the saved paths are for

`run` ends with every file it wrote. Reach for one only when the output left a question open:

- `logs/<job>-<id>.log` — the whole job log, timestamps and ANSI stripped so it greps cleanly.
  This is the fallback for anything the error block cut off.
- `logs/<job>-error-block.txt` — the printed block, whole, when the digest elided its middle.
- `logs/<job>-roster.txt` — the full test roster when there were too many to print.
- `artifacts/smoke-logs/launch-logs/launch-<n>.log` — one per app launch in the smoke run.
  The highest-numbered one is the failing launch and the digest already tails it; the earlier ones
  tell you what a passing launch looked like.
- `artifacts/smoke-logs/state-logs/launch.log` — the same launch as the app itself wrote it,
  from under the state root.
- `artifacts/smoke-traces/launch-<n>.zip` — Playwright traces, and only with `--all-artifacts` or
  `artifacts <id> --get smoke-traces`. They are 11 MB against the logs' 60 KB and hold nothing the
  launch logs do not; reach for one when a UI assertion failed and you want the DOM snapshot.
  Leave it zipped and open it with `npx playwright show-trace`.

### Artifact sizes

`installer` and `installer-previous` are ~250 MB each and are never what you need — `run`'s default
25 MB cap (`--max-mb`) skips them, and the inventory says so out loud. `smoke-traces` is ~11 MB and
is skipped by name, under the cap, because the digest only ever lists it. `smoke-logs` is ~60 KB and
comes down. Pass `--all-artifacts` only if the user explicitly wants an installer or a trace on disk.

A run from before the artifact split has one `smoke-failure` instead, traces inside it; the script
reads either name, so an old run still yields a digest.

### Why the script and not `gh run view`

`gh run view <id> --log-failed` and `gh run view --job <id> --log` come back empty or truncated on
this repo's runs. The job-log REST API (`repos/{repo}/actions/jobs/<id>/logs`) is the path that
works, and the script takes it. Reaching for the convenience command wastes a turn on nothing.

### Then fix it in the owning service

The output is diagnosis, not a licence to edit. The release smoke suite, the workflows and the
packaged tree belong to `delivery-dev`; a launch failure in the launch logs is usually
`electron-dev`'s; a failing unit test belongs to that service's subagent. Route the fix there.
