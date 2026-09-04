#!/usr/bin/env bash
# Stop/SubagentStop hook: formats changed files in place — ruff format + import
# sort for Python, prettier for JS/TS/CSS. Style never blocks the turn (it can't
# change behavior), so this always exits 0 and just reports what it rewrote.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
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

# Skips report without a duration — there is no formatting time worth showing.
skip() {
  jq -n --arg m "$1" '{systemMessage: $m, suppressOutput: true}'
  exit 0
}

run_ruff() {   # "$@" = paths
  uvx ruff format "$@" >/dev/null 2>&1
  uvx ruff check --select I --fix --quiet "$@" >/dev/null 2>&1
}
run_prettier() {
  npx prettier --write --no-error-on-unmatched-pattern "$@" >/dev/null 2>&1
}

# One-time baseline: neither formatter has ever run here, so align the whole repo
# once. Without this every later edit would arrive as a whole-file reformat diff.
if [ ! -f "$marker" ]; then
  run_ruff backend database lib
  run_prettier .
  date -Iseconds > "$marker"
  report "format ✓"
fi

mapfile -d '' -t changed < <(
  git diff --name-only -z HEAD 2>/dev/null
  git ls-files --others --exclude-standard -z 2>/dev/null
)
[ ${#changed[@]} -eq 0 ] && skip "format -"

py=() web=()
for f in "${changed[@]}"; do
  [ -f "$f" ] || continue
  case "$f" in
    backend/*.py|database/*.py|lib/*.py)           py+=("$f") ;;
    frontend/*.ts|frontend/*.tsx|frontend/*.css)   web+=("$f") ;;
    downloader/*.js|downloader/*.css|lib/*.js)     web+=("$f") ;;
  esac
done
[ $((${#py[@]} + ${#web[@]})) -eq 0 ] && skip "format -"

[ ${#py[@]}  -gt 0 ] && run_ruff "${py[@]}"
[ ${#web[@]} -gt 0 ] && run_prettier "${web[@]}"

report "format ✓"
