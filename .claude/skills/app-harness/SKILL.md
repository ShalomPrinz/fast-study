---
name: app-harness
description: Run the real app — all four services and the SPA, every third party faked, fully offline — on a private stack with its own ports and scratch data, and drive it through a headless browser. Use for development (see a change in the running app), verification (prove a change works end to end before calling it done) and debugging (reproduce a reported bug, force provider/site failures, a locked file, a vanished lecture). Several agents can each run their own stack at once.
---

The harness lives in `.claude/harness/`; its [README](../../harness/README.md) is the full reference —
what is faked and how, every `hb` helper, every fake mode, the seeded courses, the blind spots. This
skill is the short path through it.

## Start your own stack

One stack per agent, never shared: pick a harness root nobody else uses, under your scratchpad.

```bash
node .claude/harness/setup.mjs --harness <scratchpad>/harness --browsers main   # run in the background
```

Wait for `harness ready` in its output (about 10 s warm); a failed self-check aborts and names the
assumption that broke — fix that before anything else. It stays in the foreground holding the stack.

Never wrap it in `timeout` or a foreground call: the stack lives exactly as long as that process, so
a time limit kills it mid-session. Launch it with no limit in the background, redirect to a log, and
poll that log for `harness ready` for up to 3 minutes (a cold start runs the self-check's pipeline).

It runs the code of the checkout it lives in, so in a worktree run the worktree's own
`.claude/harness/setup.mjs`.

## Drive it

```bash
export HARNESS_DIR=<scratchpad>/harness
hb() { node .claude/harness/hb.mjs "$@"; }
hb url                                   # every URL of this stack; `hb url <name>` prints one
hb goto /course/hb-edit/overview         # actions take plain arguments, no JSON to escape
hb click 'text=…'
hb fill 'input[placeholder="Course name…"]' 'קורס'
hb press Enter --shot saved              # click, fill and press take --shot NAME; all take --browser TAG
hb shot dialog --before --setup "await page.click('text=…')"  # en+he, before+after → evidence/main-dialog-[before-]<lang>.png
hb download hb-dl 'הקלטה 4 — גרפים'      # Downloads → load the course → press that row's Download
hb eval <<'JS'                           # JS on stdin (or as one argument), given page and context
return page.url()
JS
B=$(hb url browser-main)                 # every other route over curl; a failed hb action exits 1
curl -s $B/text
curl -s $B/screenshot -d '{"name":"after-save"}' # → $HARNESS_DIR/evidence/main-after-save.png
curl -s $B/dom -d '{"selector":".toast","since":"-10000"}'  # always-on DOM timeline: what it matched over time
curl -s $B/dom/flicker -d '{"selector":".focus-card"}'      # content gone and back within 300 ms
```

Screenshots are always the full app window (1400×900), never cropped to an element; for a
before/after or per-language shot use `hb shot`.

The browser runs in its own network namespace; a `# harness: browser not network-isolated (<reason>)` line means it fell back to the host, where a host network change can fail a load with `net::ERR_NETWORK_CHANGED` — rerun the load.

Drive the UI only through a browser session, never your own Playwright script. Every answer ends
with the console errors and failed requests the command caused. Service logs are in
`$HARNESS_DIR/logs/`.

The seeded `hb-*` courses are ready-made fixtures (the README's table says what each holds). Force a
failure with `curl -s $(hb url providers)/control …` or `$(hb url site)/control …`, or with
`hb lock` (the file refuses writes with `423 file_locked`, its lecture and course folders refuse a
rename with `423 folder_in_use` while that file exists on disk) / `hb rm-lecture`. The site's
`radware` mode walls Moodle until a captcha is solved with `{"solve":true}`; `{"revoke":true}` makes
the next call meet a fresh captcha, with no reseed. Restart one service after a code change with
`node .claude/harness/setup.mjs --harness $HARNESS_DIR --restart <service>`. Put the baseline back
with `hb reseed`. A Gemini auto retry only waits and shows its countdown; `hb retry fire [key]` runs it now.

A helper for a fake's setting earns a new `hb` subcommand only when the job takes more than one
`/control` call or a wait between steps, as `hb moodle-busy` does; a single setting stays a `curl`.

Nothing a run shows is real provider behaviour: transcripts, summaries and downloads are fixtures.

The Playwright e2e specs run against your stack with `HARNESS_DIR=$HARNESS_DIR npm run test:e2e`.
The suite reseeds the stack (wipes scratch data, resets settings, locks and fakes), so run it on a stack whose state you don't need.

## Tear down

```bash
node .claude/harness/setup.mjs --harness $HARNESS_DIR --down
```

This stops every service, fake and browser session of that stack and no other.

