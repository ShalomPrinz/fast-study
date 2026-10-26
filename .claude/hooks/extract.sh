#!/usr/bin/env bash
# SubagentStop hook for frontend-dev: runs `npm run extract` when frontend/ sources changed and blocks
# while the Hebrew catalog has untranslated messages — "zero missing" is I18N.md's definition of done.
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
state="${TMPDIR:-/tmp}/claude-extract-${session}"

# NUL-delimited so Hebrew and spaced filenames survive.
mapfile -d '' -t changed < <(
  git diff --name-only -z HEAD 2>/dev/null
  git ls-files --others --exclude-standard -z 2>/dev/null
)
# systemMessage is the only channel that reaches the user — always report, even when idle.
report() { jq -n --arg m "$1" '{systemMessage: $m, suppressOutput: true}'; }

# Only the catalogs' owner may write them; any other agent would be told to translate files it must not touch.
kind="$(printf '%s' "$payload" | jq -r '.agent_type // empty' 2>/dev/null)"
[ "$kind" = "frontend-dev" ] || { report "extract -"; exit 0; }

ts=0
for f in "${changed[@]}"; do
  [ -f "$f" ] || continue
  case "$f" in
    frontend/src/*.ts|frontend/src/*.tsx) ts=1 ;;
  esac
done
[ "$ts" -eq 0 ] && { report "extract -"; exit 0; }

if ! out="$(cd frontend && npm run --silent extract 2>&1)"; then
  failures="[frontend] npm run extract failed:"$'\n'"$(printf '%s\n' "$out" | tail -30)"
else
  # An entry is missing when its msgstr is empty and no continuation line follows; the header is skipped.
  missing="$(awk '
    /^msgid "/ { id = $0; next }
    /^msgstr ""$/ { pending = (id != "msgid \"\""); next }
    pending { if ($0 !~ /^"/) print substr(id, 7); pending = 0 }
    END { if (pending) print substr(id, 7) }
  ' frontend/src/locales/he/messages.po)"
  if [ -z "$missing" ]; then
    rm -f "$state"
    report "extract ✓"
    exit 0
  fi
  failures="[frontend] frontend/src/locales/he/messages.po has $(printf '%s\n' "$missing" | wc -l) untranslated message(s):"$'\n'"$(printf '%s\n' "$missing" | head -30)"
fi

# An identical failure twice downgrades to a warning instead of looping — see README.md.
sig="$(printf '%s' "$failures" | md5sum | cut -d' ' -f1)"
if [ "$(cat "$state" 2>/dev/null)" = "$sig" ]; then
  rm -f "$state"
  jq -n --arg m "extract.sh still failing (unchanged) — not blocking again:"$'\n'"$failures" \
    '{systemMessage: $m, suppressOutput: false}'
  exit 0
fi

printf '%s' "$sig" > "$state"
printf 'extract.sh found problems after your change. Translate any missing message in frontend/src/locales/he/messages.po (see frontend/docs/I18N.md), then finish.\n\n%s' "$failures" >&2
exit 2
