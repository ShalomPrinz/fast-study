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

# Counts the files a formatter actually rewrote: ruff reports a tally, prettier
# lists every file it touched and suffixes the untouched ones with "(unchanged)".
ruff_reformatted() { printf '%s' "$1" | grep -oE '[0-9]+ files? reformatted' | grep -oE '^[0-9]+' || echo 0; }
prettier_reformatted() { printf '%s' "$1" | grep -c -v -e '(unchanged)' -e '^$' || true; }

run_ruff() {   # "$@" = paths
  local out
  out="$(uvx ruff format "$@" 2>&1)"
  uvx ruff check --select I --fix --quiet "$@" >/dev/null 2>&1
  ruff_reformatted "$out"
}
run_prettier() {
  local out
  out="$(npx prettier --write --no-error-on-unmatched-pattern "$@" 2>/dev/null)"
  prettier_reformatted "$out"
}

# One-time baseline: neither formatter has ever run here, so align the whole repo
# once. Without this every later edit would arrive as a whole-file reformat diff.
if [ ! -f "$marker" ]; then
  py_n="$(run_ruff backend database)"
  web_n="$(run_prettier .)"
  date -Iseconds > "$marker"
  report "format ✓ baseline pass — ruff $py_n, prettier $web_n file(s) reformatted"
fi

mapfile -d '' -t changed < <(
  git diff --name-only -z HEAD 2>/dev/null
  git ls-files --others --exclude-standard -z 2>/dev/null
)
[ ${#changed[@]} -eq 0 ] && report "format · clean tree, nothing to format"

py=() web=()
for f in "${changed[@]}"; do
  [ -f "$f" ] || continue
  case "$f" in
    backend/*.py|database/*.py)                    py+=("$f") ;;
    frontend/*.ts|frontend/*.tsx|frontend/*.css)   web+=("$f") ;;
    downloader/*.js|downloader/*.css)              web+=("$f") ;;
  esac
done
[ $((${#py[@]} + ${#web[@]})) -eq 0 ] && report "format · no formattable files changed"

py_n=0; web_n=0
[ ${#py[@]}  -gt 0 ] && py_n="$(run_ruff "${py[@]}")"
[ ${#web[@]} -gt 0 ] && web_n="$(run_prettier "${web[@]}")"

report "format ✓ ruff $py_n/${#py[@]}, prettier $web_n/${#web[@]} file(s) reformatted"
