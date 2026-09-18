import { createClient, httpError } from '@/services/http'
import { DOWNLOAD_SERVER_URL, secretHeaders, withSecretParam } from '@/services/runtime'
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

// Resolving means queued; every failure is an error status. `media` resolves an 'unknown' row, and
// `only` re-triggers a single named clip for per-job retry.
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

// One background download, grouped onto its row by `ref` (a zoom pair shares its parent's). `done`
// means the file reached the database service, not merely that the tool exited.
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

// Every non-evicted job, the source of truth the pings point at. Bypasses the shared client, whose
// toast per ConnectionError would stack in a reconnect loop.
export async function fetchJobs(): Promise<DownloadJob[]> {
  const res = await fetch(downloadServer.url('/jobs'), { headers: secretHeaders() })
  if (!res.ok) throw httpError(res)
  const data = (await res.json()) as { jobs?: DownloadJob[] }
  return data.jobs ?? []
}

// A contentless ping per job transition; `open` also calls back, for the initial sync and a resync
// after every reconnect.
export function subscribeJobs(onChange: () => void): () => void {
  return subscribe('job:change', onChange)
}

// The same contract for section runs, on its own connection so the two reflections stay
// independent.
export function subscribeRuns(onChange: () => void): () => void {
  return subscribe('run:change', onChange)
}

function subscribe(event: 'job:change' | 'run:change', onChange: () => void): () => void {
  const es = new EventSource(withSecretParam(downloadServer.url('/events')))
  es.addEventListener('open', onChange)
  es.addEventListener(event, onChange)
  return () => {
    es.removeEventListener('open', onChange)
    es.removeEventListener(event, onChange)
    es.close()
  }
}

// One row of a bulk run and the run's decision on it — mirrors the server's target shape
// (`downloader/server/docs/RUNS.md`); change one, change the other. See docs/BULK.md.
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

// Hands the section queue to the server, replacing any earlier run. Returns only the renames — the
// run itself is read back off `/runs`.
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
  const res = await fetch(downloadServer.url('/runs'), { headers: secretHeaders() })
  if (!res.ok) throw httpError(res)
  const data = (await res.json()) as { runs?: SectionRun[] }
  return data.runs ?? []
}
