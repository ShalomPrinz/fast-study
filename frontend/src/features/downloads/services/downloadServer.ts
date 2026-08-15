import { createClient, httpError } from '@/services/http'
import type { DownloadOperation, Kind } from '@/types'
import type { ProbedMedia } from './autoDownloader'
import { postReconnectAware } from './autoDownloader'

// Feature-local boundary for the downloader server, which queues every background download job and
// owns its state — both the ones discovery rows trigger and the ones the Chrome extension starts.
const downloadServer = createClient(
  import.meta.env.VITE_DOWNLOADER_URL ?? 'http://localhost:3052',
  'downloader server',
)

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
}): Promise<{ media: ProbedMedia; jobIds: string[] }> {
  return postReconnectAware<{ media: ProbedMedia; jobIds: string[] }>(
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
  const es = new EventSource(downloadServer.url('/events'))
  es.addEventListener('open', onChange)
  es.addEventListener('job:change', onChange)
  return () => {
    es.removeEventListener('open', onChange)
    es.removeEventListener('job:change', onChange)
    es.close()
  }
}
