---
description: Run the real app offline on the hunt-bugs harness and report every bug found in real user flows.
argument-hint: [optional flow or area to focus on]
---

This command **finds bugs by using the app**, not by reading it. You run the four services and the
SPA, and take the flows a user takes. Reading code is for _explaining_ a symptom you already
reproduced — never for predicting one.

The one limitation: **no third party is ever reached.** Providers, Google APIs, the lecture site and
the download binaries are local fakes, and `DATA_ROOT` is a scratch tree. Everything else — the
services, the SPA, ffmpeg/pandoc/tectonic, the disk layout, SSE, the jobs — runs for real.

`.claude/hunt-bugs/` is the harness that arranges all of that, and `setup.mjs` replaces what used to
be three steps of hand-built shims. **You do not build a harness; you use this one.**

**If arguments were passed** (e.g. `/hunt-bugs the downloads page`), restrict Step 2's sweep to that
area. Start the whole harness anyway — a service you do not drive still has to boot.

---

## Step 0 — Ground yourself

Read the root `CLAUDE.md`, the `CLAUDE.md` of every service you will drive, and
[`.claude/hunt-bugs/README.md`](../hunt-bugs/README.md) — which lists what is faked, how, and the
blind spots those fakes leave. Skim the `docs/` page for each flow you plan to take, so you know
what the app is *supposed* to do before you judge what it does.

Never read the repo-root `.env`. It is permission-denied, it holds real keys, and the harness needs
nothing from it.

---

## Step 1 — Start the harness

```bash
node .claude/hunt-bugs/setup.mjs --harness <your scratchpad>/hunt
```

Run it in the background and leave it running; it holds the stack up and Ctrl-C (or `--stop` on the
next run) takes everything down. It builds the fixtures, fakes and scratch `.env`, launches
`database → backend → downloader server → auto-downloader → dev server`, seeds the scratch data
root through `database/`'s routes, and then **proves itself** — the escape alarm refuses a real
outbound request, the fake site still serves a redirected `https://lemida.biu.ac.il`, both Python
services are running on the fake keys, a settings save misses the real `.env`, and `audio` →
`transcribe` runs green. A failed proof aborts the run.

When it aborts, fix the harness before going further — a half-working shim produces findings about
nothing. Two common ones: **ports already in use** (a previous harness or a plain `npm run dev`;
re-run with `--stop`), and a **self-check failure**, which names the assumption that broke.

It prints where everything is. What you will use most:

- `http://127.0.0.1:5173` — the app. Drive it with Playwright (chromium); save screenshots and
  traces into the harness's `evidence/`.
- `<harness>/logs/*.log` — one per service, plus `network.log`, which lists every redirected and
  refused connection. These are your primary evidence.
- `<harness>/drive/ops.jsonl` — what "upload to Drive" actually did.
- The fake course URL it prints, for the downloads page.
- `curl -s localhost:4598/control -d '{"gemini":"429"}'` and
  `curl -s localhost:4599/control -d '{"mode":"blocked"}'` — provider quota, provider outage,
  bot-protection challenge and a dead Moodle token, on demand. The README lists every mode.
- `<harness>/env-python.sh` / `env-node.sh` — source one to kill and restart a single service
  mid-flow without rebuilding its environment.

Before driving anything, read the `/health` line the script printed for each service. A tool
reported `missing` explains failures later — know it now rather than discovering it as a "bug".

---

## Step 2 — Take the flows

Work through the app as a user, not as a test matrix. Each flow: do it, watch what the UI says,
watch what the logs say, check what landed on disk. Minimum sweep (narrow to the argument if one
was passed):

1. **Settings** — the first-run wall, changing the data root, the key probe (valid and rejected),
   Drive connect/disconnect, prerequisites, and a saved setting reaching the service that reads it.
2. **Course and lecture management** — create, rename, delete, archive, a recitation, a duplicate
   name, the two seeded names that differ only by a suffix.
3. **Downloads** — list the fake course, expand the YouTube row, download one item, "download all"
   for a section, live job progress, a retry, the already-downloaded rule, and the `/gone/` and
   `/deny/` rows (404 and the 403 that drives the silent re-resolve).
4. **The pipeline** — each step alone, a full run, a re-run over existing output, two lectures at
   once (queue + lock), a manual run pulling a queued lecture out of the queue, auto-run on a video
   arriving.
5. **Failure surfacing** — drive both providers to `429` and `500`, the site to `blocked` and
   `invalidtoken`, a locked `summary.pdf`, a lecture deleted mid-run, a service killed mid-run. The
   user must end up with a truthful, readable state — a step marked failed carrying the real
   message, never a spinner that never ends.
6. **Editor and PDF** — edit a summary, save, re-render, view the PDF, check the Hebrew RTL output.
7. **Course overview** — generate, continue, re-generate, per-slug gating.
8. **Search, materials, other links, navigation** — search the corpus, add a material PDF, open
   links, deep-link to a route, reload mid-run, back/forward.
9. **Liveness** — every progress update must arrive by SSE without a reload. A state that only
   appears after a manual refresh is a bug, not a nuance.

Push the edges you would push on your own machine: the empty lecture, the very long name, a name
with a quote or a slash, a double-click on a run button, two tabs on the same lecture.

---

## Step 3 — Triage before you write anything down

For every anomaly, in this order:

1. **Reproduce it.** Run it twice. A one-off that will not repeat is recorded as flaky with that
   word, or dropped.
2. **Rule out the harness.** Prove the symptom is the app's and not a fake's — read the code path
   and say which line produces it. The README's "what is faked" table is the first place to check;
   a fake returning the wrong shape is your bug, so fix it in `.claude/hunt-bugs/` and re-run.
3. **Locate it.** Name the file and line where the defect lives, and the service that owns it.
4. **Classify severity** by what it costs a user: data loss > a flow that cannot complete > wrong
   information shown > cosmetic.

Anything you could not reproduce, could not attribute, or only suspect from reading goes in a
separate **Unconfirmed** section — never mixed with what you saw happen.

---

## Step 4 — Write the findings file

One file at the project root: `findings-<area-or-sweep>-<YYYY-MM-DD>.md`. It is the only file you
write into the repo, unless you fixed a fake. Structure:

```
# Findings — <what was driven>, <date>

**Run:** which flows, the harness root, what the self-checks proved.
**Not covered:** flows skipped and why (plus the README's blind spots that bit this sweep).

## Confirmed bugs
### <n>. <symptom in one line>
- **Severity:** critical | major | minor | cosmetic
- **Owner:** <service>/ (route to `<service>-dev`)
- **Flow:** the exact steps, numbered, that a person can retype
- **Observed:** what happened, with the verbatim error/log line
- **Expected:** and where the app says so (doc line, or the obvious user expectation)
- **Evidence:** `<harness>/evidence/...`, `<harness>/logs/...`
- **Lands in:** `path/to/file.py:42`
- **Harness ruled out by:** one line

## Unconfirmed / flaky
## Harness gaps
What the fakes could not model, so the next run knows — and what is worth adding to them.
```

Then print a summary table: severity, owner service, one-line symptom.

---

## Step 5 — Tear down

Stop the harness (Ctrl-C, or `node .claude/hunt-bugs/setup.mjs --stop`) and say so. Leave the
harness directory in place — the findings file points into it.

---

## Hard rules

- **No network off loopback.** If `network.log` shows a `REFUSED` line from a flow you drove, stop:
  something wanted the real internet. Fix the fake, re-run the flow, then judge the finding.
- **No production code edits.** This command reports; it does not fix. Do not write prompt files or
  branches either — the user decides what gets fixed and routes it to the owning service subagent.
  Editing `.claude/hunt-bugs/` to correct or extend a fake is allowed and expected.
- **No git writes**, ever. No `add`, `commit`, `stash`, `checkout`.
- **Never touch the real `.env` or the real `DATA_ROOT`.** The harness is built so you cannot; do
  not work around it.
- **Report what you saw, verbatim.** Quote the exact error text and the exact log line. A summary of
  an error is not evidence. If a flow could not be driven at all, say so plainly instead of
  inferring its outcome from the code.
