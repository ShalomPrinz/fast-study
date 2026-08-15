import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
} from 'react'
import type { ReactNode } from 'react'
import type { DownloadOperation, Kind } from '@/types'
import type { DownloadJob } from '../services/downloadServer'
import { fetchJobs, subscribeJobs } from '../services/downloadServer'
import { toastJobError } from '../utils/downloadErrors'

// One download job as the display atom for a titled ETA bar. Carries the fields a per-job retry
// needs to re-issue `/download-item` (ref/course/title=lecture/kind).
export interface JobProgress {
  id: string
  title: string
  ref: string
  course: string
  kind: Kind
  status: 'running' | 'done' | 'error'
  startedAt: number | null
  expectedBytes: number | null
  operation: DownloadOperation | null
}

function isTerminal(job: DownloadJob): boolean {
  return job.status === 'done' || job.status === 'error'
}

// The whole-row aggregate the Download/Retry button and the section summary share: running if any
// job is non-terminal, else error if any failed, else done, else null (no jobs). Retry-if-any-failed.
export function rowStatus(jobs: readonly JobProgress[]): 'running' | 'done' | 'error' | null {
  if (!jobs.length) return null
  if (jobs.some((j) => j.status === 'running')) return 'running'
  if (jobs.some((j) => j.status === 'error')) return 'error'
  return 'done'
}

// Shared identity for "this ref has no jobs". `useSyncExternalStore` compares snapshots by
// reference, so a fresh `[]` per read would re-render forever.
const EMPTY_JOBS: readonly JobProgress[] = Object.freeze([])

export type JobsByRef = ReadonlyMap<string, readonly JobProgress[]>

// Groups a `/jobs` snapshot into the per-row buckets the UI reads, once per snapshot rather than
// once per row. Sorted by lecture so a zoom pair's two bars never reorder.
export function groupJobsByRef(snapshot: DownloadJob[]): JobsByRef {
  const byRef = new Map<string, JobProgress[]>()
  for (const j of snapshot) {
    // A null ref means the Chrome extension started the job, so it belongs to no discovery row.
    if (j.ref === null) continue
    // Note: `startedAt` is the server's epoch ms and the bar measures elapsed against the browser's
    // `Date.now()` — this assumes both clocks agree; skew renders as an overflowed bar.
    const progress: JobProgress = {
      id: j.id,
      title: j.lecture,
      ref: j.ref,
      course: j.course,
      kind: j.kind,
      status: isTerminal(j) ? (j.status as 'done' | 'error') : 'running',
      startedAt: j.startedAt,
      expectedBytes: j.expectedBytes,
      operation: j.operation,
    }
    const bucket = byRef.get(j.ref)
    if (bucket) bucket.push(progress)
    else byRef.set(j.ref, [progress])
  }
  for (const bucket of byRef.values())
    bucket.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
  return byRef
}

// The miss case must be the shared `EMPTY_JOBS`, never a fresh array — see the constant.
// `readonly` is load-bearing: the hit case hands out the store's own bucket, which several rows read.
export function jobsForRef(byRef: JobsByRef, ref: string): readonly JobProgress[] {
  return byRef.get(ref) ?? EMPTY_JOBS
}

// Module-level store: one grouped snapshot for the page, with per-ref subscriptions on top of it,
// so a `job:change` ping re-renders a row only when that row has jobs at all. Because it outlives the
// provider, the provider must clear it on unmount — a stale snapshot would show phantom running jobs.
let jobsByRef: JobsByRef = new Map()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function publish(snapshot: DownloadJob[]) {
  jobsByRef = groupJobsByRef(snapshot)
  for (const listener of listeners) listener()
}

// Guard only — the jobs themselves come from the module store, not from the context value.
const DownloadJobsContext = createContext(false)

function useProviderGuard() {
  const mounted = useContext(DownloadJobsContext)
  if (!mounted) throw new Error('download job hooks must be used inside <DownloadJobsProvider>')
}

// One row's jobs, by its discovery `ref`. Subscribed per ref, so a row with no jobs never re-renders
// on a ping at all — it reads the shared `EMPTY_JOBS`. A row that has jobs gets a freshly grouped
// bucket every snapshot, so it re-renders on every ping.
export function useRowJobs(ref: string): readonly JobProgress[] {
  useProviderGuard()
  return useSyncExternalStore(
    subscribe,
    useCallback(() => jobsForRef(jobsByRef, ref), [ref]),
  )
}

// The whole map, for the bulk-queue summary — it re-derives every target's status from the current
// snapshot, so re-rendering it on every snapshot is the correct scope, not a leak.
export function useJobsByRef(): JobsByRef {
  useProviderGuard()
  return useSyncExternalStore(subscribe, () => jobsByRef)
}

// One EventSource for the page, against the downloader server (:3052) which owns the jobs.
// The stream is a contentless `job:change` ping; every ping refetches `GET /jobs`.
// The server guarantees at most one job per target in a snapshot, so we trust `/jobs` as-is.
// A `ref` groups the row, while its jobs are the display atoms. See docs/DOWNLOADS.md.
export function DownloadJobsProvider({ children }: { children: ReactNode }) {
  // Ids already toasted, so a failed job toasts once.
  // `primed` guards the first snapshot: its errors are history from before load and must not toast.
  const toastedIds = useRef<Set<string>>(new Set())
  const primed = useRef(false)

  useEffect(() => {
    let cancelled = false
    const handleSnapshot = (snap: DownloadJob[]) => {
      if (cancelled) return
      for (const job of snap) {
        if (job.status !== 'error') continue
        if (!primed.current) {
          toastedIds.current.add(job.id) // seed and suppress: history from before this session
        } else if (!toastedIds.current.has(job.id)) {
          toastJobError(job.lecture || 'recording', job.message)
          toastedIds.current.add(job.id)
        }
      }
      primed.current = true
      publish(snap)
    }
    // A failed fetch is a no-op; the stream reconnects and pings again.
    const refresh = () => {
      void fetchJobs()
        .then(handleSnapshot)
        .catch(() => {})
    }
    const close = subscribeJobs(refresh)
    // Clearing on unmount keeps the store's lifetime equal to the provider's: without it, a remount
    // after the downloader went down renders the last snapshot forever (a failed refetch is a no-op).
    return () => {
      cancelled = true
      close()
      publish([])
      primed.current = false
      toastedIds.current.clear()
    }
  }, [])

  return <DownloadJobsContext.Provider value={true}>{children}</DownloadJobsContext.Provider>
}
