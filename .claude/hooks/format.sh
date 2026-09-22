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

run_ruff() {   # "$@" = paths
  uvx ruff format "$@" >/dev/null 2>&1
  uvx ruff check --select I --fix --quiet "$@" >/dev/null 2>&1
}
run_prettier() {
  npx prettier --write --ignore-unknown --no-error-on-unmatched-pattern "$@" >/dev/null 2>&1
}

# One-time whole-repo sweep the first time this runs in a tree — see README.md.
if [ ! -f "$marker" ]; then
  run_ruff .
  run_prettier .
  date -Iseconds > "$marker"
  report "format ✓"
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

report "format ✓"
