#!/usr/bin/env bash
# Stop/SubagentStop hook: typechecks frontend/ when its sources changed. Scoped to
# TypeScript because the Python/JS parse checks it used to run are now covered by
# lint.sh (ruff E9, eslint parse errors) — this is the one thing no linter here does.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -d "$ROOT" ] || exit 0
cd "$ROOT" || exit 0

payload="$(cat)"
session="$(printf '%s' "$payload" | jq -r '.session_id // "nosession"' 2>/dev/null || echo nosession)"
state="${TMPDIR:-/tmp}/claude-typecheck-${session}"

# Changed = tracked modifications + untracked files. NUL-delimited so Hebrew and
# spaced filenames survive.
mapfile -d '' -t changed < <(
  git diff --name-only -z HEAD 2>/dev/null
  git ls-files --others --exclude-standard -z 2>/dev/null
)
[ ${#changed[@]} -eq 0 ] && exit 0

ts=0
for f in "${changed[@]}"; do
  [ -f "$f" ] || continue
  case "$f" in
    frontend/*.ts|frontend/*.tsx) ts=1 ;;
  esac
done
[ "$ts" -eq 0 ] && exit 0

# `npm run build` is tsc -b + the vite bundle; this is the same typecheck without
# the bundle. Whole-project by nature — tsc has no meaningful per-file mode.
if out="$(cd frontend && npx tsc --noEmit 2>&1)"; then
  rm -f "$state"
  exit 0
fi
failures="[frontend] tsc --noEmit failed:"$'\n'"$(printf '%s\n' "$out" | head -30)"

# Re-blocking on an identical failure would loop forever when the breakage is
# pre-existing or unfixable — report it once more as a warning and let the turn end.
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
