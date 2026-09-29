---
description: Run the real app offline on the app harness and report every bug found in real user flows.
argument-hint: [optional flow or area to focus on]
---

This command **finds bugs by using the app**, not by reading it. You run the four services and the
SPA, and take the flows a user takes. Reading code is for _explaining_ a symptom you already
reproduced — never for predicting one.

The one limitation: **no third party is ever reached.** Providers, Google APIs, the lecture site and
the download binaries are local fakes, and `DATA_ROOT` is a scratch tree. Everything else — the
services, the SPA, ffmpeg/pandoc/tectonic, the disk layout, SSE, the jobs — runs for real.

`.claude/harness/` is the app harness that arranges all of that, and `.claude/hunt-bugs/` adds the
wave's brief and findings merge on top. **You do not build a harness; you use this one.**

**You orchestrate; subagents do the work.** You start the harness, spawn one flow agent per flow and
one merge agent, relay the summary table and tear down. You never drive a flow, triage an anomaly or
read a fragment or the merged file: each of those lands in a subagent's context, so yours holds this
command, one line per flow agent, the `/health` lines and the final table.

Flow agents read this file too. What is theirs is labelled **Flow agents:**, and the hard rules bind
everyone; everything else is the orchestrator's.

**If arguments were passed** (e.g. `/hunt-bugs the downloads page`), restrict Step 2's sweep to that
area. Start the whole harness anyway — a service you do not drive still has to boot.

---

## Step 0 — Ground yourself

Flow agents ground themselves — their brief names the `CLAUDE.md` files, the harness README and the
`docs/` pages to read. You need only this command; do not read service `CLAUDE.md` files, `docs/`
or the harness README beyond what a failed start sends you to.

Never read the repo-root `.env`. It is permission-denied, it holds real keys, and the harness needs
nothing from it.

---

## Step 1 — Start the harness

```bash
node .claude/harness/setup.mjs --harness <your scratchpad>/hunt --browsers settings,mgmt,dl,pipeline,fail,edit,nav
```

`--browsers` names the flows that get a browser session, each on a port of its own.

Run it in the background with stdout and stderr redirected to `<your scratchpad>/hunt.log`, and
leave it running: it holds the stack up until
`node .claude/harness/setup.mjs --harness <same dir> --down`. Never read that log whole. Wait (up to
3 minutes) until the log shows `harness ready`, or `harness failed:` / `harness stopped:`, or the
setup process has exited; then pull only what you need with `grep`:

```bash
grep -E '^  (backend|downloader server|auto-downloader): |^harness (ready|failed|stopped)' <your scratchpad>/hunt.log
```

Before spawning any flow, read the `/health` line the script printed for each service. A tool
reported `missing` explains failures later — name it in each affected flow agent's prompt rather
than let it surface as a "bug".

It builds the fixtures, fakes and scratch `.env`, launches
`database → backend → downloader server → auto-downloader → dev server`, seeds the scratch data
root through `database/`'s routes, and then **proves itself** — the escape alarm refuses a real
outbound request, the fake site still serves a redirected `https://lemida.biu.ac.il`, both Python
services are running on the fake keys, a settings save misses the real `.env`, the app loaded in
headless chromium lists the courses and reaches every service from its origin, and `audio` →
`transcribe` runs green. A failed proof aborts the run.

When it aborts, fix the harness before going further — a half-working shim produces findings about
nothing. A **self-check failure** prints as `harness failed: <the assumption that broke>`.

**Flow agents:** the rest of this step is what the stack gives you. What you will use most:

- Every port is this harness's own: `hb.mjs --harness <same dir> url` lists them all, `url <name>`
  prints one.
- The app, at `url frontend` (localhost, not 127.0.0.1: dev CORS takes only localhost). Drive it
  only through a `browser.mjs` session — never write your own Playwright driver. Each flow owns one
  session, at `url browser-<tag>`; one not started with `--browsers` comes from
  `hb.mjs --harness <same dir> browser <tag>`. Over curl: `goto`, `click`, `fill`, `text`,
  `screenshot` (lands as `evidence/<tag>-<name>.png`), `eval`, `log`, `mutations` — the README has
  the exact calls. Every answer ends with the console errors and failed or 4xx/5xx requests the
  command caused, and every non-GET request is kept in `evidence/<tag>-mutations.jsonl` with its
  body and answer: quote both as evidence.
- `<harness>/logs/*.log` — one per service, plus `network.log`, which lists every redirected and
  refused connection. These are your primary evidence. `hb refused --since <time>` prints
  only real escapes: the self-check's deliberate probes log as `selfcheck` and are left out.
- `<harness>/drive/ops.jsonl` — what "upload to Drive" actually did.
- The fake course URL it prints, for the downloads page.
- `curl -s $(hb url providers)/control -d '{"gemini":"429"}'` and
  `curl -s $(hb url site)/control -d '{"mode":"blocked"}'` — provider quota, provider outage,
  a rejected Gemini key, bot-protection challenge and a dead Moodle token, on demand;
  `-d '{"downloadMs":60000}'` on the site makes the next downloads take a minute, with no restart.
  A provider failure can target one lecture and the next N calls —
  `-d '{"gemini":{"mode":"429","match":"hb-fail/שיעור 4","times":1}}'` — so it hits your flow's
  lecture and nobody else's. The README lists every mode.
- `node .claude/harness/setup.mjs --harness <same dir> --restart <service> [ENV=val…]` — restart
  one service mid-flow with its exact recorded environment, plus any overrides; the README lists
  the service names.
- `node .claude/harness/hb.mjs --harness <same dir> <command>` — `set NAME=value…` (a setting,
  saved as the settings screen saves it), `reseed` (baseline + flow courses on the live stack),
  `state` (save `state.json`, diff against the seed), `wall` / `unwall` (the first-run screen),
  `add-material <course> <lecture> [file]` (a material PDF, with the notify the downloader sends),
  `rm-lecture <course> <lecture>` (the folder deleted on disk, mid-run if you like),
  `lock <glob>` / `unlock` (the database fails that file as Windows does one open in a viewer —
  `423 file_locked`) and `refused`. `hb.mjs help` lists them all.
- `node .claude/hunt-bugs/hunt.mjs --harness <same dir> <command>` — `brief <tag>` (a flow agent's
  brief, Step 2) and `findings` (the merge, Step 4).
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

---

## Step 2 — Take the flows

Note the wave start (`date -u +%Y-%m-%dT%H:%M:%SZ`), then turn automatic runs off once:

```bash
node .claude/harness/hb.mjs --harness <same dir> set AUTO_RUN=off
```

Then spawn every flow agent in one message: Agent tool, `subagent_type: "general-purpose"`,
`run_in_background: true`, one per tag (`settings`, `mgmt`, `dl`, `pipeline`, `fail`, `edit`, `nav`,
or the ones an argument narrows to). Each prompt is only, with the harness as an absolute path:

```
Run `node .claude/hunt-bugs/hunt.mjs --harness <absolute harness dir> brief <tag> [focus…]` and follow the brief it prints.
```

plus a line for any tool `/health` reported `missing`. Never run `brief` yourself: it prints
[`brief.md`](../hunt-bugs/brief.md) filled in for this harness and tag — the flow's sweep items,
course, browser session, the rules below, Step 3 and the fragment format — and that belongs in the
agent's context, not yours. Each agent writes `<harness>/fragments/<tag>.md` and replies with one
line. Wait for the completion notices; do not poll fragments, logs or browser sessions meanwhile.
Note each tag whose agent failed or replied without a fragment path.

**Flow agents:** the rest of this step and Step 3 are yours.

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
reaches the Drive step — so the wave runs with `AUTO_RUN=off`. Only the pipeline flow turns it back
to `full`, for its auto-run test alone, and puts `off` back straight after. A flow that changes a
shared setting or an untargeted fake mode says so and puts it back; a provider failure aimed with
`match` at the flow's own course needs no such care.

Push the edges you would push on your own machine: the empty lecture, the very long name, a name
with a quote or a slash, a double-click on a run button, two tabs on the same lecture.

---

## Step 3 — Triage before you write anything down

**Flow agents:** you do this inside your own flow; the orchestrator never triages.

For every anomaly, in this order:

1. **Reproduce it.** Run it twice. A one-off that will not repeat is recorded as flaky with that
   word, or dropped.
2. **Rule out the harness.** Prove the symptom is the app's and not a fake's — read the code path
   and say which line produces it. The README's "what is faked" table is the first place to check;
   a fake returning the wrong shape is your bug, so fix it in `.claude/harness/` and re-run.
3. **Locate it.** Name the file and line where the defect lives, and the service that owns it.
4. **Classify severity** by what it costs a user: data loss > a flow that cannot complete > wrong
   information shown > cosmetic.

Anything you could not reproduce, could not attribute, or only suspect from reading goes in a
separate **Unconfirmed** section — never mixed with what you saw happen.

---

## Step 4 — Merge the findings

When every flow agent has reported, spawn one merge agent (`subagent_type: "general-purpose"`) with
only:

```
Do the merge agent's job in Step 4 of .claude/commands/hunt-bugs.md for harness <absolute harness dir>,
area <area-or-sweep>, date <YYYY-MM-DD>, wave start <wave start>. <The /health lines.>
<Each flow skipped, failed or with no fragment, and why.>
```

Print what it returns. Do not open the merged file.

### The merge agent's job

Each flow's findings are in `<harness>/fragments/<tag>.md`, in the format `brief.md` defines:
`## Flow:`, **Driven** and **Not covered**, then `### Confirmed` (one `####` per bug carrying
Severity, Owner, Flow, Observed, Expected, Evidence, Lands in and Harness ruled out by),
`### Unconfirmed / flaky` and `### Harness gaps`.

```bash
node .claude/harness/hb.mjs --harness <same dir> refused --since <wave start>
node .claude/harness/hb.mjs --harness <same dir> state
node .claude/hunt-bugs/hunt.mjs --harness <same dir> findings <area-or-sweep> <YYYY-MM-DD>
```

`hb refused` covers the whole wave, whatever each flow checked; put its verdict on the Run line.

`hb state` saves what the wave left changed. `hunt.mjs findings` writes
`findings-<area-or-sweep>-<YYYY-MM-DD>.md` at the project root. That is the only file the wave
writes into the repo, unless a flow fixed a fake. The merged file holds the Run line with the state
diff, the flows with no fragment, a summary table numbered by severity (severity, owner, symptom,
flow), the **Overlaps across flows** list and every fragment verbatim, its findings numbered to match.
With no fragment at all it writes nothing and says `no fragments in …`: reply with that and the
flows the orchestrator named, and stop.

A malformed fragment makes `hunt.mjs findings` write nothing and name each bad `file:line`. Fix its
shape without changing what it says, then run `hunt.mjs findings` again. It refuses to overwrite a
merged file, so delete that file first.

Then finish the merged file by hand:

- **Run:** add what the self-checks proved and the `/health` tool lines the orchestrator passed.
- **Not covered:** say why each missing flow was skipped, and which of the README's blind spots
  affected this sweep.
- **Overlaps:** each entry is a probable duplicate at the same `path:line`. Where it is one bug,
  keep the fuller write-up, list every flow in its table row, and delete the other row and section.
- Add a closing **What's left to hunt** section.

Reply with only the final summary table, the `hb refused` verdict, and one line naming every flow
with no fragment and why.

---

## Step 5 — Tear down

Stop the harness with `node .claude/harness/setup.mjs --harness <same dir> --down` and say so.
That also stops every browser session it or `hb browser` started. Do not stop them yourself. Leave the harness directory in place, because the findings file points into it. The next
session starts from what the findings file's state diff names, and `hb reseed` puts all of it back.

---

## Hard rules

- **No network off loopback.** If `hb refused --since <wave start>` prints anything but
  `no escapes`, stop: something wanted the real internet. Fix the fake, re-run the flow, then judge the finding.
- **No production code edits.** This command reports; it does not fix. Do not write prompt files or
  branches either — the user decides what gets fixed and routes it to the owning service subagent.
  Editing `.claude/harness/` to correct or extend a fake is allowed and expected.
- **No git writes**, ever. No `add`, `commit`, `stash`, `checkout`.
- **Never touch the real `.env` or the real `DATA_ROOT`.** The harness is built so you cannot; do
  not work around it.
- **Report what you saw, verbatim.** Quote the exact error text and the exact log line. A summary of
  an error is not evidence. If a flow could not be driven at all, say so plainly instead of
  inferring its outcome from the code.
