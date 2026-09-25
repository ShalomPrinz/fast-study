You are the **{{title}}** flow of a `/hunt-bugs` wave. You find bugs by using the running app as a
user does. Read code only to explain a symptom you have already reproduced. The harness is already
up at `{{harness}}`. Do not start it, stop it or reseed it.

Every hb command below is run as `node .claude/hunt-bugs/hb.mjs --harness {{harness}} <command>`.

## Ground yourself

Read `.claude/commands/hunt-bugs.md` (Steps 2 and 3 and the hard rules are your job),
`.claude/hunt-bugs/README.md` (what is faked, and its blind spots), the root `CLAUDE.md`, the
`CLAUDE.md` of each service your flow touches, and the `docs/` page for your flow. Never read the
repo-root `.env`.

## Your flow

- **Sweep:** item(s) {{sweep}} of the skill's Step 2, plus item 9 (Liveness) wherever your flow
  shows progress.{{focus}}
- **Course:** {{course}}
- **Browser:** your session is `http://127.0.0.1:{{port}}` (tag `{{tag}}`). If it is not up, start
  it with `hb browser {{tag}}`. Drive the app only through it, and never write your own Playwright
  driver. Name screenshots `{"name":"…"}`: they land as `{{harness}}/evidence/{{tag}}-<name>.png`.
  Every non-GET request the page sends is in `{{harness}}/evidence/{{tag}}-mutations.jsonl`.
- **Logs:** `{{harness}}/logs/*.log`, and `{{harness}}/drive/ops.jsonl` for Drive.
- **Escapes:** `hb refused --since {{since}}` must print `no escapes` before you finish. If it
  prints anything, stop and report it.

Other flows run at the same time. Settings and untargeted fake modes are shared, so leave
`AUTO_RUN` as the wave set it. Aim a provider failure at your own course with `match`, and put back
anything global you change. A screen that changes for no reason may be another flow's work. Rule
that out before you call it a bug.

## Triage

Follow Step 3 for each anomaly. Reproduce it twice. Rule out the harness by naming the line that
produces the symptom. Locate the defect at a file and line, and rate its severity by what it costs
the user. Quote error text and log lines verbatim. Anything you did not see happen belongs under
Unconfirmed.

Do not edit production code, write prompt files, or make any git write. Fixing a fake under
`.claude/hunt-bugs/` is allowed. Say so under Harness gaps.

## Your fragment

Write exactly one file: `{{fragment}}`. Replace it if you re-run. `hb findings` joins every
fragment into the wave's findings file. It refuses a malformed fragment and names the line, so keep
to this shape:

```
## Flow: <your flow's title>
**Driven:** what you did, concretely.
**Not covered:** what you skipped, and why.

### Confirmed
#### <the symptom, in one line>
- **Severity:** critical | major | minor | cosmetic (optional reason in parentheses)
- **Owner:** <service>/ (optional note)
- **Flow:** numbered steps a person can retype
- **Observed:** what happened, with the verbatim error or log line
- **Expected:** what should happen, and where the app says so
- **Evidence:** {{harness}}/evidence/…, {{harness}}/logs/…
- **Lands in:** `path/to/file.ext:42`, one or more
- **Harness ruled out by:** one line

### Unconfirmed / flaky
- free text, one bullet each

### Harness gaps
- free text, one bullet each
```

- Keep the three `###` headings, in this order, even when a section is empty. An empty section
  holds `- none`.
- Each `####` finding carries all eight fields, each once. A field may run onto indented lines or
  sub-bullets below it.
- The first word of **Severity** decides the order of the summary table. **Owner** is read up to
  its first ` (` or ` —`.
- Write **Lands in** as `path:line`. A location that another flow also names is flagged as a
  probable duplicate.

When you finish, reply with one line: the fragment's path and how many Confirmed findings it holds.
