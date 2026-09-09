#!/usr/bin/env bash
# Stop/SubagentStop hook: typechecks frontend/ when its sources changed — the one
# check no linter here does. Blocks the turn on failure. See README.md.
set -uo pipefail

# CLAUDE_PROJECT_DIR can outlive a deleted worktree — see README.md.
ROOT="${CLAUDE_PROJECT_DIR:-}"
[ -d "$ROOT" ] || ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -d "$ROOT" ] || exit 0
cd "$ROOT" || exit 0

payload="$(cat)"
session="$(printf '%s' "$payload" | jq -r '.session_id // "nosession"' 2>/dev/null || echo nosession)"
state="${TMPDIR:-/tmp}/claude-typecheck-${session}"

# NUL-delimited so Hebrew and spaced filenames survive.
mapfile -d '' -t changed < <(
  git diff --name-only -z HEAD 2>/dev/null
  git ls-files --others --exclude-standard -z 2>/dev/null
)
# systemMessage is the only channel that reaches the user — always report, even when idle.
report() { jq -n --arg m "$1" '{systemMessage: $m, suppressOutput: true}'; }

[ ${#changed[@]} -eq 0 ] && { report "typecheck -"; exit 0; }

ts=0
for f in "${changed[@]}"; do
  [ -f "$f" ] || continue
  case "$f" in
    frontend/*.ts|frontend/*.tsx) ts=1 ;;
  esac
done
[ "$ts" -eq 0 ] && { report "typecheck -"; exit 0; }

# Same typecheck `npm run build` does, without the vite bundle. Whole-project: tsc
# has no meaningful per-file mode.
if out="$(cd frontend && npx tsc --noEmit 2>&1)"; then
  rm -f "$state"
  report "typecheck ✓"
  exit 0
fi
failures="[frontend] tsc --noEmit failed:"$'\n'"$(printf '%s\n' "$out" | head -30)"

# An identical failure twice downgrades to a warning instead of looping — see README.md.
sig="$(printf '%s' "$failures" | md5sum | cut -d' ' -f1)"
if [ "$(cat "$state" 2>/dev/null)" = "$sig" ]; then
  rm -f "$state"
  jq -n --arg m "typecheck.sh still failing (unchanged) — not blocking again:"$'\n'"$failures" \
    '{systemMessage: $m, suppressOutput: false}'
  exit 0
fi

printf '%s' "$sig" > "$state"
printf 'typecheck.sh found problems in the code you just changed. Fix them, then finish.\n\n%s' "$failures" >&2
exit 2
