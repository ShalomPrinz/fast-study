#!/usr/bin/env bash
# Stop/SubagentStop hook: formats changed files in place — ruff format + import sort
# for Python, prettier for everything else it parses. Never blocks; always exits 0. See README.md.
set -uo pipefail

payload="$(cat)"
# The tree the session is working in, not the one it started in — see README.md.
cwd="$(printf '%s' "$payload" | jq -r '.cwd // empty' 2>/dev/null)"
ROOT="$(git -C "${cwd:-.}" rev-parse --show-toplevel 2>/dev/null)"
[ -d "$ROOT" ] || ROOT="${CLAUDE_PROJECT_DIR:-}"
[ -d "$ROOT" ] || ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -d "$ROOT" ] || exit 0
cd "$ROOT" || exit 0

marker=".claude/.format-baseline"
start=$(date +%s%N)

report() {
  ms=$(( ($(date +%s%N) - start) / 1000000 ))
  if [ "$ms" -lt 1000 ]; then t="${ms}ms"; else t="$(awk "BEGIN{printf \"%.1fs\", $ms/1000}")"; fi
  jq -n --arg m "$1 ($t)" '{systemMessage: $m, suppressOutput: true}'
  exit 0
}

# Skip report, without a duration — there is no formatting time worth showing.
skip() {
  jq -n --arg m "$1" '{systemMessage: $m, suppressOutput: true}'
  exit 0
}

RUFF="ruff@0.17.3"   # pinned so a ruff release can't reformat the repo; bump with lint.sh and package.json
# Only the repo's lockfile-pinned prettier: a global one formats differently — see README.md.
PRETTIER="node_modules/.bin/prettier"
note=""
[ -x "$PRETTIER" ] || note=", prettier skipped: not installed (npm ci)"

run_ruff() {   # "$@" = paths
  uvx "$RUFF" format "$@" >/dev/null 2>&1
  uvx "$RUFF" check --select I --fix --quiet "$@" >/dev/null 2>&1
}
run_prettier() {
  [ -x "$PRETTIER" ] || return 0
  "$PRETTIER" --write --ignore-unknown --no-error-on-unmatched-pattern "$@" >/dev/null 2>&1
}

# One-time whole-repo sweep the first time this runs in a tree — see README.md. Without the repo's
# prettier the sweep is incomplete, so the marker waits for a run that has it.
if [ ! -f "$marker" ]; then
  run_ruff .
  run_prettier .
  [ -x "$PRETTIER" ] && date -Iseconds > "$marker"
  report "format ✓$note"
fi

mapfile -d '' -t changed < <(
  git diff --name-only -z HEAD 2>/dev/null
  git ls-files --others --exclude-standard -z 2>/dev/null
)
[ ${#changed[@]} -eq 0 ] && skip "format -"

# Same scope as the sweep: every Python file to ruff, everything else to prettier, which
# skips what it cannot parse and what .prettierignore excludes.
py=() web=()
for f in "${changed[@]}"; do
  [ -f "$f" ] || continue
  case "$f" in
    *.py) py+=("$f") ;;
    *)    web+=("$f") ;;
  esac
done
[ $((${#py[@]} + ${#web[@]})) -eq 0 ] && skip "format -"

[ ${#py[@]}  -gt 0 ] && run_ruff "${py[@]}"
[ ${#web[@]} -gt 0 ] && run_prettier "${web[@]}"

report "format ✓$note"
