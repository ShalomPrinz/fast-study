# Download jobs (`src/jobs.js`)

`progress.js` renders download progress to the terminal; the job registry exposes the
same data over HTTP so a browser can render it too. Both read one `entry` object per
download — there is no second measurement path.

**Why a registry at all.** `POST /download` answers before the download starts, so its
200 means "accepted", never "downloaded". Without a job id the caller can't tell a
finished download from a failed one, and a background failure reaches nobody.

**The id is minted in the route, not the runner.** `runDownloadJob` awaits `probeSize`
(a network round-trip) before it could register anything, so a client polling with the
id it just received would find nothing. `createJob` runs synchronously in the route
handler, before any await, which makes that race impossible by construction.

## Lifecycle

`queued` → `running` (child spawned) → `done` | `error`.

`done` means the video reached the **database service**, not that the child exited 0 —
between those two the bytes sit in a private temp dir nobody else can see. A failed
`uploadVideo` is an `error` like any other. First terminal call wins, so a spawn
failure (which fires both `error` and `close`) keeps the informative reason.

`error` carries `message`: the child's stderr tail (`makeStderrTail`, last 15 lines),
the upload's error, or the thrown message — the same text the terminal logs.

## Bytes

`receivedBytes` is measured on read via `measureBytes` (curl → stat `video.mp4`,
yt-dlp → sum the temp dir). At child exit it's frozen onto the job, because the upload
deletes the temp dir a moment later and a `done` job must not report 0 bytes.

`expectedBytes` is the probed total, **null when the probe couldn't determine one** —
consumers show a byte count instead of a percent, as the terminal renderer does.

The API returns raw bytes; percent is the consumer's business. Whoever derives it must
keep the ≤99%-until-terminal clamp — yt-dlp's merge transiently overshoots the probed
sum, so an unclamped bar hits 100% and then keeps going.

## Retention

Finished jobs stay in memory `RETENTION_MS` (5 min) before eviction, so a poller on a
slow interval reliably observes the terminal state instead of a 404 it must guess at.

## Endpoints

`GET /jobs` — all non-evicted jobs; `?ids=<csv>` filters.
`GET /jobs/:id` — one job, 404 if unknown or evicted.

```json
{ "id": "…", "status": "running", "course": "…", "lecture": "…", "kind": "lecture",
  "tool": "curl", "receivedBytes": 65536, "expectedBytes": 6291456, "message": null }
```

The frontend can't call these directly — CORS here is locked to the extension origin.
It goes through `auto`'s `GET /progress`, which proxies `/jobs`.
