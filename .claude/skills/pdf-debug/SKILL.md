---
name: pdf-debug
description: Fix rendering defects the user found in their real lecture/recitation summary PDFs. Use when the user says to fix PDF issues and gives a list of lectures, each with a snippet of text the defect is near. Analyses and groups the issues by root cause, stops for approval, then fixes each group through its own orchestrator subagent.
---

The user reads the app's summary PDFs on Windows and reports defects as a loose list: a lecture name (course and number abbreviated or wrong — "אותה הרצאה" may not be the same one) and a short snippet of Hebrew/English text the defect sits near. The defect itself is not described; you find it.

Data (read-only — never write here): `/mnt/c/Users/shalo/AppData/Local/FastStudy/data`, laid out `{course}/{lecture}/` and `{course}/Recitations/{name}/`, each with `summary.md` and the `summary.pdf` the app last rendered.

Scripts (run from `backend/` with `uv run python`, so they use the current backend code):

- `../.claude/skills/pdf-debug/scripts/rerender.py <summary.md> <out_dir>` — fresh `summary.pdf` + the generated `build.tex` + `warning.txt`.
- `../.claude/skills/pdf-debug/scripts/crop.py <summary.pdf> "<anchor>" <out_dir>` — 200dpi PNG of the region around the anchor; it warns when other blocks match as well, so read that crop with care.

Work in the session scratchpad: `<scratchpad>/pdf-debug/` holding `fresh/<key>/`, `crops/<n>/` and `issues.md`.

## Phase 1 — analyse (main session, inline)

Do it yourself, not in subagents: it is a few greps and image reads, and you need the pictures in your own context to group well.

1. **Match each issue to a summary.** `grep -rln -i --include=summary.md -- "<anchor>" <data>`; try a shorter anchor, case-insensitive, without a trailing `-`/`כ-`. The anchor decides; the reported name only breaks ties. A hit in a different lecture than reported is the answer — note it in the table.
2. **Re-render** every matched summary with `rerender.py`. The stored PDF may predate fixes already on `main`; an issue the fresh render no longer shows is reported as *already fixed* and goes no further.
3. **See the defect.** `crop.py` the fresh PDF on the anchor, then Read the PNG. Pick the anchor's paragraph, and look at it right to left. Typical defects: words/numbers/punctuation on the wrong side of an English island, a mirrored or split token, literal markdown (`##`, `:::`, `**`), a missing box/heading, glyph boxes. Never judge from `get_text()` strings — they are visual order and lie about mixed lines (`backend/docs/BIDI.md`, Verifying a bidi fix).
4. **Trace it.** Find the line in `summary.md` and in `build.tex`. The diff between them names the preprocessing helper at fault; `backend/docs/BIDI.md` maps helpers to rules, and `backend/pipeline/pdf/` holds them. Confirm the cause in the code (the regex, the merge condition) — not from the symptom.
5. **Group by root cause**, not by lecture: one group = one code change. Write `issues.md`: a match table (issue, reported as, matched summary, key), then per group a table (markdown / LaTeX / PDF shows), the cause with `file` + symbol, and the fix direction.
6. **Stop and report** — one line per group: `<letter>. <issues #> — <cause in a few words> → <fix>`, plus any issue that no longer reproduces or matched nothing, and the `issues.md` path. Wait for approval; the user may drop, merge or re-scope groups.

## Phase 2 — fix (after approval)

Groups run **one at a time**, in order: they usually touch the same `backend/pipeline/pdf/` files and the LaTeX golden, so parallel runs collide. For each group, launch one `general-purpose` agent as that group's orchestrator, with this brief (fill the brackets; paste the group's section of `issues.md` verbatim):

```
You orchestrate the fix for one group of PDF rendering defects. Repo: /home/shalom/fast_study. You write no code yourself.
Group: <the group's section from issues.md, verbatim>
Affected summaries (read-only): <paths>; issues.md: <path>.
1. Launch backend-dev with a brief in the delegate skill's format (.claude/skills/delegate/SKILL.md):
   Goal: fix the root cause above. Do: fix it in the named helper; add regression tests in the
   helper's class under backend/tests/pipeline/pdf/ using each reported markdown line, plus the
   neighbouring cases the rule must keep (BIDI.md lists them); re-bless the golden only if its diff
   is the intended change and say so; update backend/docs/BIDI.md (or PDF.md) for the changed rule.
   Verify: `cd backend && uv run pytest tests/ -q` green; for each affected summary run
   .claude/skills/pdf-debug/scripts/rerender.py then crop.py on the anchor and Read the PNG to
   confirm the defect is gone and nothing nearby regressed.
2. Launch reviewer on the uncommitted diff. For each blocking finding, launch a fresh backend-dev
   with the finding, then reviewer again on that fix, until none block.
3. Commit with the git-commit skill (.claude/skills/git-commit/SKILL.md) — the user authorised this
   orchestrator to commit. Stage only this group's files; leave the user's untracked files alone.
4. Report in 150 words or fewer: commit hash and subject, tests added, the crops checked
   (paths), reviewer findings and how each was resolved, anything left open.
```

After each orchestrator returns, check `git log -1 --stat` and `git status --short`, then launch the next group. Report once at the end: one line per group with its commit, plus anything left open. The stored PDFs in the data dir stay stale until the user re-runs the PDF step in the app — say so.
