# Claude Code scripts

Scripts that project agents run themselves; unlike the [hooks](../hooks/README.md), the harness never triggers them. Stdlib and git only, read-only, plain `python3`.

## `review_preview.py`

```bash
python3 <tree>/.claude/scripts/review_preview.py [path ...]
```

Prints a Markdown preview of the uncommitted change (staged, unstaged and untracked, against `HEAD`) for the `reviewer` agent, which runs it as its first step ([reviewer.md](../agents/reviewer.md)). It reviews the tree its own copy lives in, whatever the cwd, so a worktree is previewed by running the worktree's copy. Repo-relative path arguments limit it to those files or folders — the brief's paths — so the user's unrelated dirty files stay out. It never changes git state and takes well under a second. Every flag is a lead to confirm against the diff, not a finding. Only sections with content are printed:

| Section | What it shows |
|---|---|
| Change set | `git status --short`, `git diff --stat -M HEAD`, and the full content of each untracked file (generated ones like lockfiles are named, not shown), which `git diff` leaves out. |
| Ownership | Each changed path with its writing agent from [ownership.json](../ownership.json) (or the main session) and its owning docs: every `CLAUDE.md`, `README.md` or `docs/` page that names the full path, or — inside the path's own service — a shorter path or its file name, plus docs cited in its comments. Service code outside tests whose owning docs are all absent from the change is flagged. |
| Stale references | Names removed on minus lines and not re-added on any plus line, with up to 5 `git grep` hits each (*tunable*) that still use them: `def`/`class` names and `UPPER_CASE` assignments in Python, exported or top-level declarations in JS/TS, and quoted snake-case or upper-case codes (error codes, env names) in both. |
| Changed values | Paired minus/plus lines (in order, within one change) that keep the same shape but differ in numeric or string literals: old values `->` new values, at the new line number. Lingui catalogs and lockfiles are skipped, since their line references and hashes shift on every unrelated edit. |
| Contract surfaces | Changed files on the fixed list in the script (`CONTRACTS`) — launch contract, preload bridge, routes, SSE, `DATA_ROOT` layout, error codes and catalogs, frozen-bundle inputs, workflows — each with the doc that owns it. |
| Invariants trigger | Whether reviewer check 3 applies: an outbound-HTTP library on a changed `database/` line, a `lib/` module changed in only one of its `py/`/`js/` halves, a frozen-bundle input or new top-level `backend/`/`database/` module, or a process spawn on a changed service line. Otherwise it prints "check 3 not needed". |
| Doc hygiene | Broken relative links in changed `.md` files (fenced blocks skipped), `@path` in a changed `CLAUDE.md`, and doc paths cited in changed code comments that resolve nowhere — a path with a folder, or a bare `CLAUDE.md`/`README.md`, since a bare `summary.md` is usually a data file. |
| Multi-line comments | Each comment of two or more text lines that touches a changed line, with its line range, line count and first line — `#`/`//` runs (`#` in Python and shell only), `/* */` blocks and Python docstrings, markers and blank lines not counted. One-line comments never show, and there is no hard limit: the reviewer judges whether the extra lines earn their place. |

Tests: `.claude/scripts/tests/test_review_preview.py` copies the script into a throwaway git repo and runs it there as a subprocess (clean tree, untracked file and doc hygiene from another cwd, stale Python name with changed value, ownership and invariants, stale TS export with a path filter, multi-line comments that touch the diff, one-liners and untouched blocks left out); run `uvx pytest .claude/scripts/tests -q`.
