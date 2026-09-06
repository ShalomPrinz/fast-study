#!/usr/bin/env bash
# Creates a worktree for <slug> and restores everything git does not track, so the
# app is runnable there. Invoked by the `worktree` skill as its single setup step.
set -euo pipefail

slug="${1:-}"
if [[ ! "$slug" =~ ^[a-z0-9]+(_[a-z0-9]+)*$ ]]; then
    echo "usage: setup.sh <snake_case_slug>" >&2
    exit 1
fi

# Resolve main's root from the script's own path, not the cwd — the script must never
# branch a worktree off another worktree.
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
wt="$root-$slug"

[[ -e "$wt" ]] && { echo "refusing: $wt already exists" >&2; exit 1; }
[[ -f "$root/.env" ]] || { echo "refusing: $root/.env is missing" >&2; exit 1; }

echo "==> worktree $wt on branch $slug"
git -C "$root" worktree add -b "$slug" "$wt" main

echo "==> git-ignored files"
cp "$root/.env" "$wt/.env"
cp "$root/backend/credentials.json" "$wt/backend/credentials.json"
# Copied, not symlinked: a branch under test must not write to the live timing.db or Moodle token.
cp -r "$root/.state" "$wt/.state"

echo "==> claude additionalDirectories"
settings="$root/.claude/settings.local.json"
[[ -f "$settings" ]] || echo '{}' > "$settings"
tmp="$(mktemp)"
jq --arg d "$wt" \
    '.permissions.additionalDirectories = ((.permissions.additionalDirectories // []) | if index($d) then . else . + [$d] end)' \
    "$settings" > "$tmp"
mv "$tmp" "$settings"

echo "==> npm install"
# Subshell cd, not `npm --prefix`: the root package.json declares `lib/*` workspaces,
# which --prefix resolves inconsistently.
for dir in "" /frontend /downloader/server /downloader/auto; do
    echo "--- $wt$dir"
    (cd "$wt$dir" && npm install)
done

echo "==> uv sync"
# --extra test so the service suites are runnable without a second sync.
for svc in backend database; do
    echo "--- $wt/$svc"
    (cd "$wt/$svc" && uv sync --extra test)
done

echo
echo "worktree ready: $wt (branch $slug)"
