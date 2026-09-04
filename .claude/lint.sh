#!/usr/bin/env bash
# Stop/SubagentStop hook: lints whichever changed files belong to a linted stack —
# ruff for backend/ + database/ + lib/, eslint for frontend/ + downloader/ + lib/.
# Catches the undefined-name and dead-symbol class that a syntax check and tsc both miss.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -d "$ROOT" ] || exit 0
cd "$ROOT" || exit 0

payload="$(cat)"
session="$(printf '%s' "$payload" | jq -r '.session_id // "nosession"' 2>/dev/null || echo nosession)"
state="${TMPDIR:-/tmp}/claude-lint-${session}"

mapfile -d '' -t changed < <(
  git diff --name-only -z HEAD 2>/dev/null
  git ls-files --others --exclude-standard -z 2>/dev/null
)
# A passing Stop hook's stdout goes to the debug log only, so the one channel
# that reaches the user is systemMessage — always report, even when idle.
report() { jq -n --arg m "$1" '{systemMessage: $m, suppressOutput: true}'; }

[ ${#changed[@]} -eq 0 ] && { report "lint -"; exit 0; }

py=() jsts=()
for f in "${changed[@]}"; do
  [ -f "$f" ] || continue
  case "$f" in
    backend/*.py|database/*.py|lib/*.py)                          py+=("$f") ;;
    frontend/*.ts|frontend/*.tsx|downloader/*.js|lib/*.js)        jsts+=("$f") ;;
  esac
done

failures=""

# ruff config lives in the root ruff.toml (pyflakes-level only, no style).
if [ ${#py[@]} -gt 0 ]; then
  if ! out="$(uvx ruff check --quiet --output-format concise "${py[@]}" 2>&1)"; then
    failures+="[ruff]"$'\n'"$(printf '%s\n' "$out" | head -30)"$'\n\n'
  fi
fi

# One eslint install at the repo root covers every JS/TS surface — see eslint.config.js.
if [ ${#jsts[@]} -gt 0 ]; then
  if ! out="$(npx eslint "${jsts[@]}" 2>&1)"; then
    failures+="[eslint]"$'\n'"$(printf '%s\n' "$out" | head -30)"$'\n\n'
  fi
fi

# CSS lives beside the component that uses it — see frontend/docs/ARCHITECTURE.md. These three
# greps are the whole enforcement: a global stylesheet can only come back through main.tsx.
main_tsx="frontend/src/main.tsx"
css_bad=""
if [ -f "$main_tsx" ]; then
  stray="$(grep -nE "^import .*\.css'" "$main_tsx" | grep -v "styles/tokens.css" || true)"
  [ -n "$stray" ] && css_bad+="main.tsx imports a stylesheet other than styles/tokens.css:"$'\n'"$stray"$'\n'
fi
if [ -f frontend/src/styles/tokens.css ]; then
  cls="$(grep -nE '^\s*\.[a-zA-Z]' frontend/src/styles/tokens.css || true)"
  [ -n "$cls" ] && css_bad+="tokens.css holds the reset and :root only — no class selectors:"$'\n'"$cls"$'\n'
fi
[ -f frontend/src/index.css ] && css_bad+="frontend/src/index.css is back; component CSS belongs beside its component."$'\n'
if [ -n "$css_bad" ]; then
  failures+="[css]"$'\n'"$css_bad"$'\n'
fi

if [ -z "$failures" ]; then
  rm -f "$state"
  if [ $((${#py[@]} + ${#jsts[@]})) -eq 0 ]; then
    report "lint -"
  else
    report "lint ✓"
  fi
  exit 0
fi

# Re-blocking on an identical failure would loop forever when the breakage is
# pre-existing or unfixable — report it once more as a warning and let the turn end.
sig="$(printf '%s' "$failures" | md5sum | cut -d' ' -f1)"
if [ "$(cat "$state" 2>/dev/null)" = "$sig" ]; then
  rm -f "$state"
  jq -n --arg m "lint.sh still failing (unchanged) — not blocking again:"$'\n'"$failures" \
    '{systemMessage: $m, suppressOutput: false}'
  exit 0
fi

printf '%s' "$sig" > "$state"
printf 'lint.sh found problems in the code you just changed. Fix them, then finish.\n\n%s' "$failures" >&2
exit 2
