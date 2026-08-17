# Section runs (`src/runs.js`)

A **run** is one section's bulk "download all": the queue, its progress, each row's disposition
and the passcode pause, owned here rather than in the page that started it. `jobs.js` tracks one
file; a run tracks the sweep that triggers many, the same way `backend/runner.py` owns the pipeline
sweep and the frontend only reflects it.

**Why server-side.** The client-side queue dies with the tab: a reload mid-sweep loses the
progress, the recorded dispositions and a passcode prompt the user was one keystroke from
answering. Held here, the queue keeps triggering and the page is a view of it.

## The record

```js
{ id, sectionId, course, targets, at, total, status, paused }
```

- **`sectionId`** is the frontend's section identity, `${course}:${media}:${title}`.
- **`at`** is the 1-based position the queue is on; `total` is `targets.length`.
- **`status`** is `running | paused | done | reconnect | cancelled`.
- **`paused`** is `{ index, reason, name }` or null — `reason` is auto's passcode reason
  (`missing` | `incorrect`).

**One run per `sectionId`.** Starting a run replaces that section's previous record outright. That
is what makes a run re-findable after a reload with no id to remember, and it removes any need for
time-based eviction — a section holds one record, forever or until the process dies. Runs are
in-memory only: a run that dies with the process is not recovered.

**A submit for a section already `running` or `paused` joins it**: `POST /download-section` answers
the in-flight `{runId}` and starts no second driver. An active section is already reflected in the
UI, so a duplicate submit (two tabs on the course, or one that missed a ping) should join rather
than restart or error at the user — and two drivers over one section would re-trigger every
remaining row concurrently, since the caller's `skipped` verdicts were computed against a course
tree that has not refreshed yet. Replacement is what happens for a run in a terminal status
(`done` | `reconnect` | `cancelled`).

The driver holds its own reference to the run, so it re-checks the registry around every await: a
run that was cancelled or replaced by a newer one for the same section stops where it is, and the
next transition it would have written never lands.

**A throw is contained to its target.** Anything that fails while triggering a row — auto
unreachable, a 2xx whose body doesn't conform — records that row `queue-failed` and the queue
continues; there is no retry. A throw from outside a target's work abandons the run as `cancelled`.
A run is never left silently at `running`, which would disable the section's button until a restart.

## Dispositions

Each target is `{ ref, name, kind, media, disposition }`, and its disposition is what the run
itself decided about that row:

| disposition   | meaning                                                                    |
| ------------- | -------------------------------------------------------------------------- |
| `pending`     | the queue has not reached it yet                                           |
| `skipped`     | the caller decided it was already on disk (see below)                      |
| `queued`      | triggered; jobs exist, and its outcome is read later off the tree and jobs |
| `unsupported` | auto 422'd — the source genuinely can't be handled                          |
| `queue-failed`| anything else failed while triggering it                                    |

`queued` is the only disposition whose outcome is still open. The run never derives an outcome:
"did this land" is read from the database course tree plus `/jobs`, both live, by whoever renders
the run. `media` is the POST's answer for a `queued` row (it says where on disk the file lands) and
the row's own media otherwise.

## The status mapping

The driver maps the orchestrator's status (`downloadItem`, the same function `POST /download-item`
answers with) onto the run, and it is the exact mapping the frontend's client-side queue has always
used:

- **2xx** → `disposition:'queued'`, continue.
- **401** → `status:'reconnect'`, stop. The Moodle session is gone; every remaining row would fail
  the same way.
- **409** → `status:'paused'` holding at this index (below).
- **422** → `disposition:'unsupported'`, continue — one row's verdict, not the run's.
- **anything else** (500, 502, auto unreachable) → `disposition:'queue-failed'`, continue.

## Pause and resume

A 409 parks the run at its index and holds **indefinitely** — no timeout. auto's `withLock`
serializes browser work per call, so a parked run owns no browser lock and costs nothing but a Map
entry; a timeout would silently discard work the user is one passcode away from resuming.

`POST /runs/:id/resume` re-enters the driver at the paused index, retrying that same row. The
passcode is **not** in this request: the client saves it through auto's `POST /zoom/passcode` first,
because the passcode store (`auto/src/lib/passcodes.js`) stays in auto under the service split.
`{skip:true}` instead marks the gated row `queue-failed` and continues from the next index — what a
user who gives up on that one row wants. Resume is rejected (409) on a run that isn't parked;
re-entering a running driver would trigger every remaining row a second time.

`POST /runs/:id/cancel` abandons the remainder and sets `status:'cancelled'` — cancelling a passcode
prompt gives up the whole sweep, not just the gated row.

## The skip rule stays with the caller

Targets arrive with `skipped` already stamped on the rows the caller knows are on disk. That rule
reads the live course tree, which only the frontend has, and the invariant that the green row and
the queue's skip can never disagree is worth more than moving the rule here. **The accepted cost:**
a row that becomes downloaded by something *outside this run* mid-queue is no longer skipped — it is
re-triggered and simply overwrites itself. The signal that would justify moving the rule is that
happening often enough to waste real bandwidth.

## `RunTarget` is a cross-wire contract

The target shape above is TypeScript in
`frontend/src/features/downloads/services/downloadServer.ts` (`RunTarget`) and plain JS
here. **Change one, change the other** — like `shared/utils/inFlightKey.ts` ↔ `runner.py::_skey`
and `popup.js::suggestLectureName` ↔ `nextName.ts`. The server adds `pending` to the union: a
client-side queue only ever recorded a row it had already got through, while a run holds its whole
queue from the start.

`name` is **canonicalized on arrival** by `validate.js::storedName`, which ports
`database/fs/paths.py::safe_name` (the authority — change one, change the other). The database
rewrites a name on its way to disk (`Lecture: 3` → `Lecture 3`), so a run that kept the submitted
spelling would compare forever against a tree holding the stored one. The run's targets, job
titles and PUTs therefore all carry the stored spelling, and `POST /download-section` answers
`renames: [{ ref, name }]` — one entry per row the server rewrote, `[]` when nothing changed — so
the caller can re-label its rows. A name `storedName` rejects — traversal, or nothing legal left
after the rewrite — is a 400, not a run. `POST /download-item` reports the same `renames` for its single row.

## Endpoints

| Method + path            | Body → answer                                                      |
| ------------------------ | ------------------------------------------------------------------ |
| `POST /download-section` | `{sectionId, course, targets}` → `{runId, renames}` — the section's active run, or a new one driven in the background |
| `POST /runs/:id/resume`  | `{skip?}` → `{}` (404 unknown, 409 not parked)                     |
| `POST /runs/:id/cancel`  | → `{}` (404 unknown)                                                |
| `GET  /runs`             | `{runs}` — every current run, one per section                       |

`GET /runs` is the resync, exactly as `/jobs` is for jobs: every transition fires one contentless
`run:change` frame on the same `/events` stream, and the client refetches. There is no second
stream and no polling. A frame costs each connected client a `GET /runs`, so the driver advances
`at` past a whole stretch of caller-decided rows on one frame — an all-skipped section is a couple
of frames, not one per row.
