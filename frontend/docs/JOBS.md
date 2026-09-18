# Download jobs

How a started download is followed. The same reflection serves single rows and bulk runs
([BULK.md](BULK.md)).

## The reflection

`POST /download-item` answering 200 means **queued**, never done — every failure to queue is an error
status. Treating the 200 as the outcome would report "Downloaded ✓" mid-download and swallow every
background failure.

`DownloadJobsProvider` mirrors `RunnerStatusContext`: `GET /jobs` is the single source of truth, and the
downloader server's `GET /events` is a contentless `job:change` ping per transition (queued, start, end),
each answered by a refetch. **No byte count is transported** — the bar is a client-side ETA, so following a
download costs one connection and a refetch per transition. `open` fires on connect and every reconnect
and refetches too, covering the initial sync and any gap. A failed refetch is a no-op.

Refetches go through `utils/sequencedRefresh.ts`, so only the newest reply publishes: the last `done` is
the final ping, and an older reply landing after it would republish the job as `running` — a live bar and
a section wedged busy, with nothing left to correct it.

The provider is mounted in `Layout`, so the connection, the snapshot and the error-toast dedupe outlive
the route — one always-open `EventSource`, the price of following downloads from anywhere. The store is
module-level, so the provider clears it on unmount.

## Grouping by `ref`

Every job carries the discovery-row `ref` it belongs to — a zoom before/after-break pair lands as
`<name>.1`/`<name>.2`, both under the parent's `ref` — so the row-to-job link is server-side: no client id
map, and a reload re-attaches for free. A null `ref` is a Chrome-extension job and is dropped.

The server guarantees **one job per target**: `createJob` evicts any prior terminal job for the same
`(course, lecture, kind, ref)`, so the client trusts the snapshot with no dedupe. A `done` job is evicted
after a short bridge until the tree SSE arrives; an `error` is evicted only by a retry.

Each snapshot is grouped once into `Map<ref, JobProgress[]>`, read through `useSyncExternalStore`.
`useRowJobs(ref)` subscribes a row to its own ref, so rows with no jobs read the shared frozen
`EMPTY_JOBS` and bail out of every ping; `useJobsByRef()` hands `SectionGroup` the whole map for the bulk
summary. The context exists only to fail loudly outside the provider.

## Bars and retry

A ref's jobs are the display atoms, sorted by lecture so a pair's bars never reorder. Each
`JobProgressBar` owns its own `useTimingStats(operation, expectedBytes)` — `download:curl` or
`download:ytdlp`, two buckets because their throughput differs — so one unknown size blanks only its own
bar. The `.1`/`.2` title shows only with more than one bar. The bar is `MainView`'s `ProgressBar`, with
the same states. `startedAt` is the server's clock compared to the browser's `Date.now()`, which assumes
the two agree.

`rowStatus(jobs)`: running if any job is non-terminal, else error if any failed, else done. On a split row
(more than one job) each terminal clip gets its own **Retry ✗** or **Re-download ↻** (`only: true`
re-triggers just that clip; a done clip confirms overwrite first), and the main control becomes a
non-clickable status label so it can never overwrite the whole row. A lone job retries from the main
button.

`RecordingRow` integrates the display and owns the overwrite confirm; `useRecordingDownload` is the
download effect only; `RecordingJobList` is presentational.

## Failure toasts

The provider, not the row, toasts a job failure (`toastJobError`), so single and bulk rows share one
place. Each error id toasts once; a `primed` flag seeds the first snapshot's errors as history. Because
the provider is app-wide, a job that fails while the user is elsewhere toasts there and then.
