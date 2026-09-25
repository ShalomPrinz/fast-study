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
node .claude/hunt-bugs/setup.mjs --harness <your scratchpad>/hunt --browsers mgmt,dl,edit,nav
```

`--browsers` names the flows that get a browser session (the README lists the tags and ports).

Run it in the background and leave it running; it holds the stack up, and Ctrl-C or
`setup.mjs --harness <same dir> --down` takes everything down. It builds the fixtures, fakes and scratch `.env`, launches
`database → backend → downloader server → auto-downloader → dev server`, seeds the scratch data
root through `database/`'s routes, and then **proves itself** — the escape alarm refuses a real
outbound request, the fake site still serves a redirected `https://lemida.biu.ac.il`, both Python
services are running on the fake keys, a settings save misses the real `.env`, the app loaded in
headless chromium lists the courses and reaches every service from its origin, and `audio` →
`transcribe` runs green. A failed proof aborts the run.

When it aborts, fix the harness before going further — a half-working shim produces findings about
nothing. Two common ones: **ports already in use** (a previous harness or a plain `npm run dev`;
re-run with `--stop`), and a **self-check failure**, which names the assumption that broke.

It prints where everything is. What you will use most:

- `http://localhost:5173` — the app (localhost, not 127.0.0.1: the CORS allowlists name only
  localhost). Drive it only through a `browser.mjs` session — never write your own Playwright
  driver. Each flow owns one session on its port (`mgmt` 4710, `dl` 4711, `edit` 4712, `nav` 4713,
  `pipeline` 4714, `fail` 4715, `settings` 4716); one not started with `--browsers` comes from
  `hb.mjs --harness <same dir> browser <tag>`. Over curl: `goto`, `click`, `fill`, `text`,
  `screenshot` (lands as `evidence/<tag>-<name>.png`), `eval`, `log`, `mutations` — the README has
  the exact calls. Every answer ends with the console errors and failed or 4xx/5xx requests the
  command caused, and every non-GET request is kept in `evidence/<tag>-mutations.jsonl` with its
  body and answer: quote both as evidence.
- `<harness>/logs/*.log` — one per service, plus `network.log`, which lists every redirected and
  refused connection. These are your primary evidence. `hb refused --since <wave start>` prints
  only real escapes: the self-check's deliberate probes log as `selfcheck` and are left out.
- `<harness>/drive/ops.jsonl` — what "upload to Drive" actually did.
- The fake course URL it prints, for the downloads page.
- `curl -s localhost:4598/control -d '{"gemini":"429"}'` and
  `curl -s localhost:4599/control -d '{"mode":"blocked"}'` — provider quota, provider outage,
  a rejected Gemini key, bot-protection challenge and a dead Moodle token, on demand;
  `-d '{"downloadMs":60000}'` on the site makes the next downloads take a minute, with no restart.
  A provider failure can target one lecture and the next N calls —
  `-d '{"gemini":{"mode":"429","match":"hb-fail/שיעור 4","times":1}}'` — so it hits your flow's
  lecture and nobody else's. The README lists every mode.
- `node .claude/hunt-bugs/setup.mjs --harness <same dir> --restart <service> [ENV=val…]` — restart
  one service mid-flow with its exact recorded environment, plus any overrides; the README lists
  the service names.
- `node .claude/hunt-bugs/hb.mjs --harness <same dir> <command>` — `set NAME=value…` (a setting,
  saved as the settings screen saves it), `reseed` (baseline + flow courses on the live stack),
  `state` (save `state.json`, diff against the seed), `wall` / `unwall` (the first-run screen),
  `add-material <course> <lecture> [file]` (a material PDF, with the notify the downloader sends),
  `rm-lecture <course> <lecture>` (the folder deleted on disk, mid-run if you like),
  `lock <glob>` / `unlock` (the database fails that file as Windows does one open in a viewer —
  `423 file_locked`), `refused`, `brief <tag>` (a flow agent's brief, Step 2) and `findings` (the
  merge, Step 4). `hb.mjs help` lists them all.
- PDFs: no `pdftotext`/`pdftoppm` here — read and render them with PyMuPDF through
  `cd backend && uv run python`; the README has the two one-liners.

The stack starts from a known baseline: fake keys, Drive **connected**, Moodle connected, both fakes
`ok`, `AUTO_RUN=full`. Each flow has its own seeded course — `hb-mgmt`, `hb-dl`, `hb-edit`,
`hb-nav`, `hb-pipeline`, `hb-fail` (the README's table says what each holds); `hb-selfcheck` is
nobody's. A flow works in its own course and creates any new course with its own prefix, so flows
run side by side without damaging each other's data.
Step 2's flows map onto them as: management → `hb-mgmt`, downloads → `hb-dl`, pipeline and course
overview → `hb-pipeline`, failure surfacing → `hb-fail`, editor and PDF → `hb-edit`, search,
materials and navigation → `hb-nav`.

Before driving anything, read the `/health` line the script printed for each service. A tool
reported `missing` explains failures later — know it now rather than discovering it as a "bug".

---

## Step 2 — Take the flows

Run each flow as its own agent, side by side. Hand each one its brief verbatim:
`hb brief <tag> [focus…]` prints [`brief.md`](../hunt-bugs/brief.md) filled in for this harness
and tag (`settings`, `mgmt`, `dl`, `pipeline`, `fail`, `edit`, `nav`). The brief holds the flow's
sweep items, course, browser session, the rules below and Step 3. It also defines the fragment
format. Each agent writes its findings to `<harness>/fragments/<tag>.md`. A flow you take yourself
writes the same fragment.

Work through the app as a user, not as a test matrix. Stay in your flow's course (Settings and
Liveness touch whatever they need). Each flow: do it, watch what the UI says,
watch what the logs say, check what landed on disk. Minimum sweep (narrow to the argument if one
was passed):

1. **Settings** — the first-run wall (`hb wall`, reload, then `hb unwall`), switching the data root
   to the empty marked `<harness>/data-empty`, changing the data root, the key probe (valid and rejected),
   Drive connect/disconnect, prerequisites, and a saved setting reaching the service that reads it.
2. **Course and lecture management** — create, rename, delete, archive, a recitation, a duplicate
   name, the two seeded names that differ only by a suffix.
3. **Downloads** — list the fake course, expand the YouTube row, download one item, "download all"
   for a section, live job progress (slow it with `downloadMs` and reload mid-download), a
   material landing as a PDF, the already-downloaded rule, and the failure rows: `/gone/` (a dead
   link), `/deny/` (a 403; download it twice, since only the retry replays from the cache and
   drives the silent re-resolve) and `/die/` (drops halfway the first time, so its retry succeeds).
4. **The pipeline** — each step alone, a full run, a re-run over existing output, two lectures at
   once (queue + lock), a manual run pulling a queued lecture out of the queue, auto-run on a video
   arriving.
5. **Failure surfacing** — drive both providers to `429` and `500` (targeted at `hb-fail`'s
   lectures), Gemini to `invalidkey`, a key containing `bad` in the settings screen, the site to
   `blocked` and `invalidtoken`, a locked `summary.pdf` (`hb lock`), a lecture deleted mid-run (`hb rm-lecture`), a service killed mid-run. The
   user must end up with a truthful, readable state — a step marked failed carrying the real
   message, never a spinner that never ends.
6. **Editor and PDF** — edit a summary, save, re-render, view the PDF, check the Hebrew RTL output.
7. **Course overview** — generate, continue, re-generate, per-slug gating.
8. **Search, materials, other links, navigation** — search the corpus, add a material PDF (`hb add-material`: the UI has no attach), open
   links, deep-link to a route, reload mid-run, back/forward.
9. **Liveness** — every progress update must arrive by SSE without a reload. A state that only
   appears after a manual refresh is a bug, not a nuance.

Settings are global. Automatic runs queue a pipeline run for every downloaded video, and each run
reaches the Drive step — when flows run side by side, set `hb set AUTO_RUN=off` once for the wave
and leave auto-run itself to the pipeline flow, which turns it back on (`AUTO_RUN=full`) alone. A
flow that changes a shared setting or an untargeted fake mode says so and puts it back; a provider
failure aimed with `match` at the flow's own course needs no such care.

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

## Step 4 — Merge the findings

Each flow's findings are in `<harness>/fragments/<tag>.md`, in the format `brief.md` defines:
`## Flow:`, **Driven** and **Not covered**, then `### Confirmed` (one `####` per bug carrying
Severity, Owner, Flow, Observed, Expected, Evidence, Lands in and Harness ruled out by),
`### Unconfirmed / flaky` and `### Harness gaps`.

When every flow agent has reported:

```bash
node .claude/hunt-bugs/hb.mjs --harness <same dir> state
node .claude/hunt-bugs/hb.mjs --harness <same dir> findings <area-or-sweep> <YYYY-MM-DD>
```

`hb state` saves what the wave left changed. `hb findings` writes
`findings-<area-or-sweep>-<YYYY-MM-DD>.md` at the project root. That is the only file you write into
the repo, unless you fixed a fake. The merged file holds the Run line with the state diff, the flows
with no fragment, a summary table numbered by severity (severity, owner, symptom, flow), the
**Overlaps across flows** list and every fragment verbatim, its findings numbered to match.

A malformed fragment makes `hb findings` write nothing and name each bad `file:line`. Send the
fragment back to its agent, or fix its shape yourself without changing what it says. Then run
`hb findings` again. It refuses to overwrite a merged file, so delete that file first.

Then finish the merged file by hand:

- **Run:** add what the self-checks proved and the `/health` tool lines.
- **Not covered:** say why each missing flow was skipped, and which of the README's blind spots
  affected this sweep.
- **Overlaps:** each entry is a probable duplicate at the same `path:line`. Where it is one bug,
  keep the fuller write-up, list every flow in its table row, and delete the other row and section.
- Add a closing **What's left to hunt** section.

Then print the summary table.

---

## Step 5 — Tear down

Stop the harness (Ctrl-C, or `node .claude/hunt-bugs/setup.mjs --harness <same dir> --down`) and
say so. That also stops every browser session it or `hb browser` started. Do not stop them
yourself. Leave the harness directory in place, because the findings file points into it. The next
session starts from what the findings file's state diff names, and `hb reseed` puts all of it back.

---

## Hard rules

- **No network off loopback.** If `hb refused --since <wave start>` prints anything, stop:
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
