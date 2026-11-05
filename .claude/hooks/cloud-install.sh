#!/usr/bin/env bash
# SessionStart hook: in a cloud session only, installs the root, frontend/ and downloader/ npm deps and
# syncs backend/ and database/, so lint, format, tests and the harness's package deps are ready from the first turn.
set -uo pipefail
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -d "$ROOT" ] || exit 0
cd "$ROOT" || exit 0

failed=()

# npm ci wipes node_modules, so skip it when the lockfile matches the one it last installed from.
npm_install() {   # $1 = package dir
  local dir="$1" stamp="$1/node_modules/.cloud-lock-hash" hash
  hash="$(sha256sum "$dir/package-lock.json" | cut -d' ' -f1)"
  [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$hash" ] && return 0
  if (cd "$dir" && npm ci --no-audit --no-fund >/dev/null 2>&1); then
    printf '%s' "$hash" > "$stamp"
  else
    failed+=("npm ci in $dir")
  fi
}

npm_install .
npm_install frontend
npm_install downloader
# uv sync is already a no-op when the venv matches the lock.
for dir in backend database; do
  (cd "$dir" && uv sync --quiet >/dev/null 2>&1) || failed+=("uv sync in $dir")
done

# SessionStart stdout reaches Claude as context, so name a failure there rather than fail the session.
if [ ${#failed[@]} -gt 0 ]; then
  printf 'Cloud install failed: %s. Rerun it before relying on lint, tests or the harness.\n' "${failed[*]}"
fi
exit 0
