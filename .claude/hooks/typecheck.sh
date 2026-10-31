#!/usr/bin/env bash
# Stop/SubagentStop hook: typechecks frontend/ when its sources changed — the one
# check no linter here does. Blocks the turn on failure. See README.md.
set -uo pipefail

payload="$(cat)"
# The tree the session is working in, not the one it started in — see README.md.
cwd="$(printf '%s' "$payload" | jq -r '.cwd // empty' 2>/dev/null)"
ROOT="$(git -C "${cwd:-.}" rev-parse --show-toplevel 2>/dev/null)"
[ -d "$ROOT" ] || ROOT="${CLAUDE_PROJECT_DIR:-}"
[ -d "$ROOT" ] || ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -d "$ROOT" ] || exit 0
cd "$ROOT" || exit 0

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

# Shared by every session and subagent on this tree, keyed by its path — see README.md.
cache="${TMPDIR:-/tmp}/claude-typecheck-tree-$(printf '%s' "$ROOT" | md5sum | cut -c1-12)"
mkdir -p "$cache"

# Everything tsc reads that git can see; lib/ too, since frontend links @faststudy/sentry from it.
inputs() {
  {
    git rev-parse HEAD
    git diff --binary HEAD -- frontend lib
    git ls-files --others --exclude-standard -z -- frontend lib |
      while IFS= read -r -d '' f; do [ -f "$f" ] && printf '%s\0' "$f" && cat "$f"; done
    cat frontend/node_modules/.package-lock.json 2>/dev/null
  } | md5sum | cut -d' ' -f1
}
passed() { [ "$(cat "$cache/ok" 2>/dev/null)" = "$1" ]; }

before="$(inputs)"
passed "$before" && { rm -f "$state"; report "typecheck ✓ (unchanged)"; exit 0; }

# One tsc per tree at a time, so parallel agents never write the build info together.
exec 9>"$cache/lock"
if flock -w 60 9; then
  # A parallel run may have passed these exact inputs while this one waited.
  passed "$before" && { rm -f "$state"; report "typecheck ✓ (unchanged)"; exit 0; }
  incr=(--incremental --tsBuildInfoFile "$cache/tsbuildinfo")
else
  incr=()
fi

# Same typecheck `npm run build` does, without the vite bundle. Whole-project: tsc
# has no meaningful per-file mode; --incremental rechecks only what a change reaches.
if out="$(cd frontend && npx tsc --noEmit "${incr[@]}" 2>&1)"; then
  rm -f "$state"
  # Stamp only if nothing moved mid-run, else tsc may have checked a mix of two states.
  if [ "$(inputs)" = "$before" ]; then
    printf '%s' "$before" > "$cache/ok.$$" && mv -f "$cache/ok.$$" "$cache/ok"
  fi
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
