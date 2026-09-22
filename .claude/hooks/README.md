# Hooks

Three scripts wired to `Stop` and `SubagentStop` in [`../settings.json`](../settings.json), so they
run at the end of every turn and every subagent. They exist to keep the repo's stated invariants —
"new code lands lint-clean", "never hand-format" — true without anyone remembering them.

| Script | Does | Blocks the turn |
| ------ | ---- | --------------- |
| `format.sh` | `ruff format` + import sort on Python, prettier on every other file it parses, in place | never |
| `lint.sh` | `ruff check` + `eslint` at pyflakes/recommended level, plus the frontend CSS layout rules | yes |
| `typecheck.sh` | `tsc --noEmit` over `frontend/` | yes |

All three act only on **changed files** — tracked modifications against `HEAD` plus untracked files,
read NUL-delimited so Hebrew and spaced filenames survive. `typecheck.sh` is the exception in scope:
it *triggers* on a changed `.ts`/`.tsx` but then checks the whole project, because `tsc` has no
meaningful per-file mode.

## Why they look the way they do

**A passing hook's stdout is invisible.** It reaches the debug log, not the user, so the one channel
that shows up in the transcript is a `systemMessage` in JSON on stdout. That's why each script ends
in a `report()` that emits `{systemMessage, suppressOutput}` even when it did nothing — the `-`
in `lint -` is how you know the hook ran and found nothing to do, rather than silently failing.

**Blocking is `exit 2` with the failure on stderr.** That returns the message to the agent as
feedback and keeps the turn alive so it can fix the problem.

**Blocking twice on the same failure would loop forever.** A pre-existing or unfixable breakage
would otherwise re-block every time the agent tried to finish. `lint.sh` and `typecheck.sh` each
hash the failure text into `$TMPDIR/claude-{lint,typecheck}-$session`; an identical hash on the next
run downgrades to a visible warning and lets the turn end. The state file is per-session and cleared
on success.

**The tree is the session's `cwd`, not `CLAUDE_PROJECT_DIR`.** A session started in the main
checkout that edits a worktree by absolute path keeps `CLAUDE_PROJECT_DIR` on main, so a hook keyed
on it checks the wrong tree and reports `-`. Each script takes the git top-level of the hook input's
`cwd`, falling back to `CLAUDE_PROJECT_DIR` and then its own `git rev-parse --show-toplevel`.

**The format baseline.** `format.sh` sweeps the entire repo the first time it runs in a tree and
drops [`../.format-baseline`](../.format-baseline) (git-ignored). Without that one-time pass every
later edit to a never-formatted file would arrive as a whole-file reformat diff. The per-turn pass
covers the same files the sweep does, so no file drifts until the next sweep rewrites it. A new worktree
inherits the marker — see [`../skills/worktree/setup.sh`](../skills/worktree/setup.sh).

**`lint.sh` also enforces the frontend CSS layout** — three greps asserting `main.tsx` imports no
stylesheet but `styles/tokens.css`, that `tokens.css` holds no class selector, and that a root
`index.css` hasn't come back. The rule and its rationale live in
[`../../frontend/docs/ARCHITECTURE.md`](../../frontend/docs/ARCHITECTURE.md); the greps are only its
enforcement.

## Scope

Linter configuration is not here: `ruff.toml` and `eslint.config.js` at the repo root are the single
config for every service, and `.prettierrc` carries the per-service semicolon split. A hook that
needs a new rule almost always wants a config change instead.

A green hook means the code parses, typechecks, and has no undefined or dead symbols. It never means
the code works.
