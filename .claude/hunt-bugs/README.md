# hunt-bugs harness

Agent tooling, not app code. It runs the real four services and the real SPA with every third party
replaced by a local fake, so a bug hunt can take real user flows without a real key, a real account,
MFA, or any traffic off loopback. `/hunt-bugs` drives it; nothing in the app imports it.

```bash
node .claude/hunt-bugs/setup.mjs                 # build, launch, prove, stay up (Ctrl-C stops all)
node .claude/hunt-bugs/setup.mjs --harness DIR   # put the scratch root somewhere specific
node .claude/hunt-bugs/setup.mjs --stop          # kill whatever holds the ports first, then start
node .claude/hunt-bugs/setup.mjs --reseed        # wipe the scratch data back to the fixtures
node .claude/hunt-bugs/setup.mjs --no-launch     # fakes + fixtures only, print where the env files are
node .claude/hunt-bugs/setup.mjs --skip-pipeline-check   # skip the slowest self-check
```

It refuses to start when any of its ports is already listening — a previous harness or a plain
`npm run dev` would answer `/health` and pass for this run's stack, with someone else's data root
behind it. `--stop` terminates them first, and only processes it recognises as FastStudy's.

Re-running against the same harness directory keeps the data the last sweep left, which is usually
what you want when chasing a bug; `--reseed` starts from the fixtures again.

**Nothing a run shows you is real.** Transcripts, summaries, downloads, course listings and Drive
uploads are fixtures. A conclusion about how the app behaves against a real provider, a real lecture
site or real data cannot be drawn from here.

## What is faked, and how

| Third party         | Faked by                                                              | Attached through                               |
| ------------------- | --------------------------------------------------------------------- | ---------------------------------------------- |
| Groq, Gemini        | `fakes/providers.mjs` — both wire formats, real SDKs reach it         | `services.providers`' base URLs, rewritten     |
| Google Drive        | an in-process fake service writing `drive/store.json` + `ops.jsonl`   | `googleapiclient.discovery.build`, replaced    |
| Drive OAuth consent | a pending → connected flow with no browser and no account            | `services.google_auth`, four functions replaced |
| The lecture site    | `fakes/site.mjs` — Moodle WS, pluginfile PDFs, media, over http + TLS | every non-loopback socket, redirected          |
| `curl`, `yt-dlp`    | `fakes/tool.mjs` — writes the fixture video in slices, never connects | first on `PATH`, where `toolPath()` looks      |
| The Moodle login    | a pre-seeded WS token in the state root                               | `state/auth/biu-token.json`                    |

The two shims (`shim/sitecustomize.py` on `PYTHONPATH`, `shim/node.mjs` through `NODE_OPTIONS`)
patch imported modules from outside. **No production file is edited, and none may be** — a mock
switch inside shipped code is exactly what `services/providers.py` keeps the base URL in its table
to avoid.

The Node shim works at the socket, not at `fetch`: the services import `spawn`, `request` and
friends as ESM named bindings, which a module-object patch cannot reach.

## The guarantees, each proved before handover

`setup.mjs` aborts unless all of these hold, because a silently broken shim costs more than no
harness: the fakes answer; a Python process and a Node process are both refused off loopback while
the fake site still serves a redirected `https://lemida.biu.ac.il`; both services log the harness
keys (the repo `.env` lost the `load_dotenv` race); a settings save lands in the scratch `.env` and
leaves the real one untouched; and `audio` (real ffmpeg) → `transcribe` (fake Groq) runs green.

`DATA_ROOT` is a tree the harness made, marked with `.hunt-bugs-scratch`; it refuses to run against
a data root without that marker.

## Driving failures

The fakes take a mode, so the quota and outage flows need no real quota:

```bash
curl -s localhost:4598/control -d '{"gemini":"429"}'   # ok | 429 | 500 | empty, per provider
curl -s localhost:4599/control -d '{"mode":"blocked"}' # ok | blocked | invalidtoken
```

A download URL is its own switch: `/gone/` fails 404, `/deny/` fails 403 — the auth signature that
drives the downloader's one silent re-resolve.

## Blind spots

The Electron shell and the installer (this is the dev stack), real provider behaviour and real
quota accounting, the headed Moodle and zoom logins with MFA, zoom capture (it needs a real
browser), and Google Drive's own semantics beyond create/update.
