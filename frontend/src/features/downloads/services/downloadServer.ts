import { createClient, httpError } from '@/services/http'
import { DOWNLOAD_SERVER_URL } from '@/services/runtime'
import type { DownloadOperation, Kind } from '@/types'
import type { Media, PasscodeError, ProbedMedia } from './autoDownloader'
import { postReconnectAware } from './autoDownloader'

// Feature-local boundary for the downloader server, which queues every background download job and
// owns its state — both the ones discovery rows trigger and the ones the Chrome extension starts.
const downloadServer = createClient(DOWNLOAD_SERVER_URL, 'downloader server')

// A name the server rewrote to be legal on disk, keyed by the submitted row's `ref`. Only the rows
// it actually changed are listed, so an untouched submission answers with [].
export interface Rename {
  ref: string
  name: string
}

// Resolving means queued — every failure leaves as an error (401/409/422/500), forwarded verbatim
// from the auto-downloader, hence the shared reconnect-aware POST. `media` is what the item turned
// out to be: the answer that resolves an 'unknown' row without a re-list. `only` re-triggers a
// single named item (a zoom split clip) without re-downloading its siblings — used by per-job retry.
export async function downloadItem(args: {
  ref: string
  course: string
  name: string
  kind: Kind
  only?: boolean
}): Promise<{ media: ProbedMedia; jobIds: string[]; renames?: Rename[] }> {
  return postReconnectAware<{ media: ProbedMedia; jobIds: string[]; renames?: Rename[] }>(
    downloadServer,
    '/download-item',
    args,
  )
}

// Which downloader ran it — the backend keeps a timing bucket per tool. Null before the child
// spawns and the real one is known.
export type DownloadTool = 'curl' | 'yt-dlp' | null

// One background download. `ref` is the discovery-row id that spawned it (a zoom before/after-break
// pair lands under `<name>.1`/`<name>.2` but both carry the parent row's `ref`), so the UI groups a
// row's jobs by `job.ref`. `expectedBytes` is null when the size probe couldn't determine a size
// (common for yt-dlp), `startedAt` (epoch ms) is null until the child spawns, and `done` means the
// video reached the database service — not merely that the tool exited.
export interface DownloadJob {
  id: string
  status: 'queued' | 'running' | 'done' | 'error'
  course: string
  lecture: string
  kind: Kind
  tool: DownloadTool
  operation: DownloadOperation | null
  ref: string | null
  expectedBytes: number | null
  startedAt: number | null
  message: string | null
}

// Every non-evicted job, including ones the Chrome extension started. The single source of truth —
// the stream only says "something changed", this says what. Bypasses the shared client because a
// reconnect loop against a downed service would stack one ConnectionError toast per attempt.
export async function fetchJobs(): Promise<DownloadJob[]> {
  const res = await fetch(downloadServer.url('/jobs'))
  if (!res.ok) throw httpError(res)
  const data = (await res.json()) as { jobs?: DownloadJob[] }
  return data.jobs ?? []
}

// `job:change` is a contentless "refetch now" ping fired on every job transition (queued, start,
// end). `open` fires on connect and every auto-reconnect, so calling `onChange` there gives the
// initial sync plus a resync for any events missed during a reconnect gap.
export function subscribeJobs(onChange: () => void): () => void {
  return subscribe('job:change', onChange)
}

// The same contract one level up: `run:change` fires on every section-run transition. Its own
// subscription rather than a shared one, so the runs reflection and the jobs reflection stay
// independent — the price is a second connection to the same `/events` stream.
export function subscribeRuns(onChange: () => void): () => void {
  return subscribe('run:change', onChange)
}

function subscribe(event: 'job:change' | 'run:change', onChange: () => void): () => void {
  const es = new EventSource(downloadServer.url('/events'))
  es.addEventListener('open', onChange)
  es.addEventListener(event, onChange)
  return () => {
    es.removeEventListener('open', onChange)
    es.removeEventListener(event, onChange)
    es.close()
  }
}

// One row of a section's bulk run, and what the run itself decided about it. Mirrors the server's
// target shape one-for-one (`downloader/server/docs/RUNS.md` — change one, change the other).
// `pending` means the queue has not reached the row yet; `queued` is the only disposition whose
// outcome is still open — it is read later off the tree and the jobs, keyed on `media`, the POST's
// answer for a queued row and the row's own media otherwise.
export interface RunTarget {
  ref: string
  name: string
  kind: Kind
  media: Media | 'unsupported'
  disposition: 'pending' | 'queued' | 'skipped' | 'unsupported' | 'queue-failed'
}

// One section's bulk run as the server holds it: at most one per `sectionId`, which is the
// frontend's own `${course}:${media}:${title}`. `at` is the 1-based position the queue is on.
export interface SectionRun {
  id: string
  sectionId: string
  course: string
  targets: RunTarget[]
  at: number
  total: number
  status: 'running' | 'paused' | 'done' | 'reconnect' | 'cancelled'
  paused: { index: number; reason: PasscodeError['reason']; name: string } | null
}

// Hand the whole section queue to the server, which drives it and owns its progress from here on.
// Replaces whatever run that section had. Targets arrive with `skipped`/`unsupported` already
// stamped: that rule reads the live course tree, which only the page has. Answers with the names it
// rewrote — the run itself is read back off `/runs`, so the run id is of no use here.
export async function startSectionRun(args: {
  sectionId: string
  course: string
  targets: RunTarget[]
}): Promise<Rename[]> {
  const { renames } = await downloadServer.post<{ runId: string; renames?: Rename[] }>(
    '/download-section',
    { json: args },
  )
  return renames ?? []
}

// Continue a run parked at a passcode gate; `skip` gives up on the gated row and moves to the next.
// The passcode itself is saved through auto first — the passcode store stays there.
export async function resumeRun(id: string, skip = false): Promise<void> {
  await downloadServer.post<void>(`/runs/${encodeURIComponent(id)}/resume`, { json: { skip } })
}

// Abandons the rest of the queue, not just the row it is parked on.
export async function cancelRun(id: string): Promise<void> {
  await downloadServer.post<void>(`/runs/${encodeURIComponent(id)}/cancel`)
}

// Every current run, one per section — the resync for `run:change`, exactly as `/jobs` is for jobs.
// Bypasses the shared client for the same reason `fetchJobs` does.
export async function fetchRuns(): Promise<SectionRun[]> {
  const res = await fetch(downloadServer.url('/runs'))
  if (!res.ok) throw httpError(res)
  const data = (await res.json()) as { runs?: SectionRun[] }
  return data.runs ?? []
}
