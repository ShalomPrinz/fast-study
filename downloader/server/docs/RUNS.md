# Section runs (`src/runs.js`)

A **run** is one section's bulk "download all": the queue, its progress, each row's disposition and
the passcode pause, owned here rather than in the page that started it. `jobs.js` tracks one file; a
run tracks the sweep that triggers many — the same way `backend/` owns the pipeline sweep and the
frontend only reflects it.

**Why server-side.** A queue held in the page dies with the tab: a reload mid-sweep would lose the
progress, the recorded dispositions and a passcode prompt the user was one keystroke from answering.
Held here, the queue keeps triggering and the page is a view of it.

## The record

`{ id, sectionId, course, targets, at, total, status, paused }`

- **`sectionId`** is the frontend's section identity, `${course}:${media}:${title}`.
- **`at`** is the 1-based position the queue is on, not a count of work done: rows it only walked past
  (`skipped`, `unsupported`) are behind it, so two skips and one download read `3/3` while that
  download starts.
- **`status`** is `running | paused | done | reconnect | cancelled`.
- **`paused`** is `{ index, reason, name }` or null — `reason` is auto's passcode reason.

**One run per `sectionId`.** Starting a run replaces that section's previous record outright, which
makes a run re-findable after a reload with no id to remember and removes any need for time-based
eviction. Runs are in-memory only; one that dies with the process is not recovered.

**A submit for a section already `running` or `paused` joins it** (`POST /download-section` answers
the in-flight `runId`). A duplicate submit — two tabs, or one that missed a ping — should join rather
than restart or error, and two drivers over one section would re-trigger every remaining row, since
the caller's `skipped` verdicts were computed against a tree that hasn't refreshed yet. A run in a
terminal status is replaced.

The driver holds its own reference to the run and re-checks the registry around every await, so a
run cancelled or replaced mid-flight stops where it is and writes nothing further.

**A throw is contained to its target.** Anything failing while triggering a row — auto unreachable, a
malformed 2xx — records that row `queue-failed` and the queue continues, with no retry. A throw
outside a target's work ends the run `cancelled`; a run is never left at `running`, which would
disable the section's button until a restart.

## Dispositions

Each target is `{ ref, name, kind, media, disposition }`:

| disposition    | meaning                                                                    |
| -------------- | -------------------------------------------------------------------------- |
| `pending`      | the queue hasn't reached it yet                                            |
| `skipped`      | the caller decided it was already on disk (below)                          |
| `queued`       | triggered; jobs exist, and its outcome is read later off the tree and jobs |
| `unsupported`  | auto 422'd — the source genuinely can't be handled                         |
| `queue-failed` | anything else failed while triggering it                                   |

`queued` is the only disposition whose outcome is still open, and the run never derives one: "did
this land" is read from the database tree plus `/jobs` by whoever renders the run. For a `queued` row
`media` is the POST's answer (where the file lands); otherwise the row's own.

## The status mapping

The driver maps `downloadItem`'s status (the same function `POST /download-item` answers with):

- **2xx** → `queued`, continue.
- **401** → `status:'reconnect'`, stop — the Moodle session is gone and every remaining row would fail.
- **409** → `status:'paused'` at this index (below).
- **422** → `unsupported`, continue — one row's verdict, not the run's.
- **anything else** (500, 502, auto unreachable) → `queue-failed`, continue.

## Pause and resume

A 409 parks the run **indefinitely**. auto's `withLock` is per call, so a parked run holds no browser
and costs a Map entry; a timeout would silently discard work the user is one passcode away from.

`POST /runs/:id/resume` re-enters the driver at the paused index, retrying that row. The passcode is
**not** in this request: the client saves it through auto's `POST /zoom/passcode` first, because the
passcode store stays in auto/. `{skip:true}` marks the gated row `queue-failed` and continues from
the next. Resume on a run that isn't parked is a 409 `run_not_paused` (and an id nobody registered
a 404 `run_unknown`) — re-entering a running driver would trigger every remaining row twice. `POST /runs/:id/cancel` gives up the whole sweep, not just the gated row.

`GET /runs` is the resync, exactly as `/jobs` is for jobs: every transition fires one contentless
`run:change` on the shared `/events` stream. A frame costs each client a `GET /runs`, so the driver
advances `at` past a whole stretch of caller-decided rows on one frame.

## The skip rule stays with the caller

Targets arrive with `skipped` already stamped on rows the caller knows are on disk. That rule reads
the live course tree, which only the frontend has, and the invariant that the green row and the
queue's skip never disagree is worth more than moving it here. **The accepted cost:** a row that
lands through something _outside this run_ mid-queue is re-triggered and overwrites itself. The
signal to move the rule is that happening often enough to waste real bandwidth.

## `RunTarget` is a cross-wire contract

The target shape is TypeScript in `frontend/src/features/downloads/services/downloadServer.ts`
(`RunTarget`) and plain JS here (`routes/runs.js`). **Change one, change the other.**

`name` is **canonicalized on arrival** by `validate.js::storedName` (a port of
`database/fs/paths.py::safe_name`). The database rewrites a name on its way to disk
(`Lecture: 3` → `Lecture 3`), so a run keeping the submitted spelling would compare forever against a
tree holding the stored one. Targets, job titles and PUTs therefore all carry the stored spelling,
and `POST /download-section` answers `renames: [{ ref, name }]` — one per rewritten row, `[]` when
none — so the caller can re-label. A name `storedName` rejects is a 400, not a run.
