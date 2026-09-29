# hunt-bugs

The `/hunt-bugs` wave's own pieces, on top of the app harness in [`../harness/`](../harness/README.md),
which runs the stack, the fakes and the browser sessions. This folder holds only what a bug hunt adds:
the flow agents' brief, the fragment format, and the merge into one findings file.

A wave runs one stack per flow, each its own harness root `<wave>/<tag>` under one wave root, so no
flow's settings, fake modes or data reach another's.

```bash
node .claude/hunt-bugs/hunt.mjs --harness WAVE/dl brief dl [focus…]   # a flow agent's brief, for its own stack
node .claude/hunt-bugs/hunt.mjs --wave WAVE findings sweep 2026-09-25 # WAVE/*/fragments/*.md → findings-sweep-2026-09-25.md
```

The flows are `settings`, `mgmt`, `dl`, `pipeline`, `fail`, `edit` and `nav`, each a browser tag and,
but for `settings`, one of the harness's seeded `hb-*` courses. `brief` needs the flow's
`browser-<tag>` session already running, since the brief names its port.

`brief` prints [`brief.md`](brief.md) with this harness's paths and the flow's sweep items, course
and browser port filled in (`FLOWS`, `findings.mjs`). Extra words narrow the flow. `brief.md` is also
the only definition of the fragment format, which each flow agent writes to `fragments/<tag>.md`.

`findings <area> <date>` treats each `<wave>/<tag>/` holding a `fragments/` dir as one stack, parses
every fragment across them and writes `findings-<area>-<date>.md` at the repo
root, or at `--out FILE`. It will not overwrite an existing file. It checks every fragment before
writing anything, and a malformed fragment fails the merge with each `file:line` and the rule it
breaks. That covers a missing section or field, an unknown field, a Severity outside
`critical | major | minor | cosmetic`, a Lands in with no `path:line`, and a stray unindented line,
so no finding is dropped silently. The output holds:

- the wave root, every stack root and the flows merged;
- each stack's `state-seed.json` → `state.json` diff, which is why each flow runs `hb state` before
  replying, while its stack is still up;
- the known flows with no fragment;
- a summary table numbered by severity;
- the **Overlaps across flows** list, meaning the same `path:line` in the Lands in of findings from
  two or more flows;
- each fragment verbatim, its `####` headings numbered to match the table.

Overlaps are only flagged, never merged. Deciding what counts as one bug is left to the wave's merge agent.
