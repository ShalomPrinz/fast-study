import { createClient, httpError } from '@/services/http'
import { DOWNLOAD_SERVER_URL, secretHeaders, withSecretParam } from '@/services/runtime'
import type { DownloadOperation, Kind, ToolReport } from '@/types'
import type { ErrorParams } from '@/shared/i18n/serviceErrors'
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

// `captchaSolved` is present (only ever true) when this item's zoom capture waited on screen for a
// captcha and then caught the player; it is per-answer, so it never names another queued download.
export interface DownloadItemResult {
  media: ProbedMedia
  jobIds: string[]
  renames?: Rename[]
  captchaSolved?: true
}

// Resolving means queued; every failure is an error status. `media` resolves an 'unknown' row, and
// `only` re-triggers a single named clip for per-job retry.
export async function downloadItem(args: {
  ref: string
  course: string
  name: string
  kind: Kind
  only?: boolean
}): Promise<DownloadItemResult> {
  return postReconnectAware<DownloadItemResult>(downloadServer, '/download-item', args)
}

// The manual-entry form's request: any http(s) link through yt-dlp, with no credentials. A 400 is
// `invalid_request` naming its `field`; `target` is `course/lecture` in the stored spelling.
export interface UrlDownload {
  url: string
  course: string
  lecture: string
  kind: Kind
}

export async function downloadUrl(
  args: UrlDownload,
): Promise<{ status: string; target: string; jobId: string }> {
  return downloadServer.post<{ status: string; target: string; jobId: string }>('/download-url', {
    json: args,
  })
}

// Which downloader ran it — the backend keeps a timing bucket per tool. Null before the child
// spawns and the real one is known.
export type DownloadTool = 'curl' | 'yt-dlp' | null

// One background download, grouped onto its row by `ref` (a zoom pair shares its parent's). `done`
// means the file reached the database service, not merely that the tool exited.
export interface DownloadJob {
  id: string
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'
  course: string
  lecture: string
  kind: Kind
  tool: DownloadTool
  operation: DownloadOperation | null
  ref: string | null
  expectedBytes: number | null
  startedAt: number | null
  // The protocol's failure fields on a terminal `error` job; null on `cancelled`, a status, not a failure (repo-root docs/ERROR-CODES.md).
  message: string | null
  code?: string | null
  params?: ErrorParams | null
}

// A general-mode download (`dest:'folder'`) into the user's chosen computer folder: no course, no
// lecture. `fileName` is the requested name until `done`, then the name actually saved.
export interface FolderJob {
  id: string
  status: DownloadJob['status']
  folder: string
  fileName: string
  tool: DownloadTool
  operation: DownloadOperation | null
  expectedBytes: number | null
  startedAt: number | null
  message: string | null
  code?: string | null
  params?: ErrorParams | null
}

// Split at this boundary so a folder job, whose course/lecture/kind are null, never reaches a
// lecture row, a manual card or the course-rename lock.
export interface JobsSnapshot {
  boot: string | null
  jobs: DownloadJob[]
  folderJobs: FolderJob[]
}

// `/jobs` as sent; `dest` is absent from a server that predates general mode, which is all app jobs.
export type WireJob = DownloadJob & {
  dest?: 'app' | 'folder'
  folder?: string | null
  fileName?: string | null
}

// yt-dlp and curl as the server's boot probe found them; answers once that probe settles.
export async function fetchDownloadServerTools(): Promise<ToolReport> {
  return (await downloadServer.get<{ tools: ToolReport }>('/tools')).tools
}

// Every non-evicted job plus the server's per-process `boot` id (null from an older server), the source
// of truth the pings point at. Bypasses the shared client, whose toast per ConnectionError would stack
// in a reconnect loop.
export async function fetchJobs(): Promise<JobsSnapshot> {
  const res = await fetch(downloadServer.url('/jobs'), { headers: secretHeaders() })
  if (!res.ok) throw httpError(res)
  const data = (await res.json()) as { boot?: string; jobs?: WireJob[] }
  return { boot: data.boot ?? null, ...splitJobs(data.jobs ?? []) }
}

// App jobs and folder jobs apart, each in the server's order.
export function splitJobs(wire: WireJob[]): Omit<JobsSnapshot, 'boot'> {
  const jobs: DownloadJob[] = []
  const folderJobs: FolderJob[] = []
  for (const { dest, folder, fileName, ...job } of wire) {
    if (dest !== 'folder') jobs.push(job)
    else folderJobs.push(folderJob(job, folder ?? '', fileName ?? ''))
  }
  return { jobs, folderJobs }
}

function folderJob(j: DownloadJob, folder: string, fileName: string): FolderJob {
  const { id, status, tool, operation, expectedBytes, startedAt, message, code, params } = j
  return {
    id,
    status,
    folder,
    fileName,
    tool,
    operation,
    expectedBytes,
    startedAt,
    message,
    code,
    params,
  }
}

// Stops a queued or running job; it ends `cancelled` via the usual ping. A no-op on a terminal job;
// 404 `job_unknown` when it already left `/jobs`.
export async function cancelJob(id: string): Promise<void> {
  await downloadServer.post<void>(`/jobs/${encodeURIComponent(id)}/cancel`)
}

// Saves the folder general-mode downloads land in; a 400 is `general_folder_missing`,
// `general_folder_not_writable` or `invalid_request` (field `folder`).
export async function setGeneralFolder(folder: string): Promise<void> {
  await downloadServer.post<{ folder: string }>('/general-folder', { json: { folder } })
}

// The popup asking this window to open the native picker at the current `folder`. A `?picker=1`
// stream of its own: with none open the server answers the popup 409, so open it only with a picker.
export function subscribeFolderPick(onPick: (folder: string | undefined) => void): () => void {
  const es = new EventSource(withSecretParam(downloadServer.url('/events?picker=1')))
  const listener = (e: MessageEvent<string>) => {
    let folder: unknown
    try {
      folder = (JSON.parse(e.data) as { folder?: unknown }).folder
    } catch {
      folder = undefined
    }
    onPick(typeof folder === 'string' && folder ? folder : undefined)
  }
  es.addEventListener('folder:pick', listener)
  return () => {
    es.removeEventListener('folder:pick', listener)
    es.close()
  }
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
  // Set once this row's own zoom capture waited on the captcha and caught the player; never false.
  captchaSolved?: true
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
