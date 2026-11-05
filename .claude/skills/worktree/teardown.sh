#!/usr/bin/env bash
# Removes the <slug> worktree, its local and remote branch, and its additionalDirectories entry —
# only once the work is committed and its PR is merged. The inverse of setup.sh.
set -euo pipefail

slug="${1:-}"
# The PR number is for a PR whose head branch is not named <slug>, e.g. one pushed from a cloud session.
pr="${2:-}"
if [[ ! "$slug" =~ ^[a-z0-9]+(_[a-z0-9]+)*$ || ! "$pr" =~ ^[0-9]*$ ]]; then
    echo "usage: teardown.sh <snake_case_slug> [pr_number]" >&2
    exit 1
fi

# The common git dir belongs to main, so this resolves main's root even when run from the worktree's copy.
root="$(dirname "$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --path-format=absolute --git-common-dir)")"
wt="$root-$slug"
# The worktree is about to disappear, so nothing below may run with it as the cwd.
cd "$root"

git show-ref --verify --quiet "refs/heads/$slug" || { echo "refusing: no local branch $slug" >&2; exit 1; }

if [[ -d "$wt" ]]; then
    dirty="$(git -C "$wt" status --porcelain)"
    [[ -z "$dirty" ]] || { printf 'refusing: %s has uncommitted changes\n%s\n' "$wt" "$dirty" >&2; exit 1; }
fi

# Squash merges keep the branch's commits off main, so ask GitHub instead of `git branch --merged`.
if [[ -n "$pr" ]]; then
    read -r merged_tip remote_branch < <(gh pr view "$pr" --json state,baseRefName,headRefName,isCrossRepository,commits \
        --jq 'if .state == "MERGED" and .baseRefName == "main" and (.isCrossRepository | not) then "\(.commits[-1].oid) \(.headRefName)" else "" end') || true
    [[ -n "${merged_tip:-}" ]] || { echo "refusing: PR #$pr is not merged into main" >&2; exit 1; }
else
    remote_branch="$slug"
    merged_tip="$(gh pr list --head "$slug" --base main --state merged --json commits --jq '.[0].commits[-1].oid // empty')"
    [[ -n "$merged_tip" ]] || { echo "refusing: no merged PR from $slug into main" >&2; exit 1; }
fi
# A tip past the merged one means commits landed after the merge and would be lost.
local_tip="$(git rev-parse "refs/heads/$slug")"
[[ "$local_tip" == "$merged_tip" ]] || {
    echo "refusing: local $slug is at $local_tip but the merged PR ended at $merged_tip" >&2
    exit 1
}

echo "==> remote branch"
if git ls-remote --exit-code --heads origin "$remote_branch" > /dev/null; then
    git push origin --delete "$remote_branch"
else
    echo "origin/$remote_branch already gone"
fi

echo "==> worktree $wt"
[[ -d "$wt" ]] && git worktree remove "$wt"
git worktree prune

echo "==> local branch"
# -D, not -d: after a squash merge git never sees the branch as merged.
git branch -D "$slug"

echo "==> claude additionalDirectories"
settings="$root/.claude/settings.local.json"
if [[ -f "$settings" ]]; then
    tmp="$(mktemp)"
    jq --arg d "$wt" \
        'if .permissions.additionalDirectories then .permissions.additionalDirectories -= [$d] else . end' \
        "$settings" > "$tmp"
    mv "$tmp" "$settings"
fi

echo
echo "torn down: $slug"
