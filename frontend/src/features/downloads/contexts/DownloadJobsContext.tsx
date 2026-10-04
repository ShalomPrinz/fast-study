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
import { sequencedRefresh } from '../utils/sequencedRefresh'
import { useCourseRunActive } from './SectionRunsContext'

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

// Shared identity for "this row has no jobs". `useSyncExternalStore` compares snapshots by
// reference, so a fresh `[]` per read would re-render forever.
const EMPTY_JOBS: readonly JobProgress[] = Object.freeze([])

export type JobsByRef = ReadonlyMap<string, readonly JobProgress[]>

// A row's bucket key. Course-qualified because a ref names a Moodle item, not a course: two courses
// listing the same page share every ref, and must never see or retry each other's jobs.
function rowKey(course: string, ref: string): string {
  return `${course}\0${ref}`
}

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
    const key = rowKey(j.course, j.ref)
    const bucket = byRef.get(key)
    if (bucket) bucket.push(progress)
    else byRef.set(key, [progress])
  }
  for (const bucket of byRef.values())
    bucket.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
  return byRef
}

// The miss case must be the shared `EMPTY_JOBS`, never a fresh array — see the constant.
// `readonly` is load-bearing: the hit case hands out the store's own bucket, which several rows read.
export function jobsForRef(byRef: JobsByRef, course: string, ref: string): readonly JobProgress[] {
  return byRef.get(rowKey(course, ref)) ?? EMPTY_JOBS
}

// Courses a non-terminal job is writing into — extension-started (null ref) jobs included, since they
// land in the course just the same.
export function coursesWithActiveJobs(snapshot: DownloadJob[]): ReadonlySet<string> {
  return new Set(snapshot.filter((j) => !isTerminal(j)).map((j) => j.course))
}

// Module store of the grouped snapshot with per-ref subscriptions; it outlives the provider, which
// clears it on unmount so no phantom jobs survive.
let jobsByRef: JobsByRef = new Map()
let activeCourses: ReadonlySet<string> = new Set()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function publish(snapshot: DownloadJob[]) {
  jobsByRef = groupJobsByRef(snapshot)
  activeCourses = coursesWithActiveJobs(snapshot)
  for (const listener of listeners) listener()
}

// Guard only — the jobs themselves come from the module store, not from the context value.
const DownloadJobsContext = createContext(false)

function useProviderGuard() {
  const mounted = useContext(DownloadJobsContext)
  if (!mounted) throw new Error('download job hooks must be used inside <DownloadJobsProvider>')
}

// One row's jobs, by course and `ref`. A row with none reads the shared `EMPTY_JOBS` and never re-renders on a
// ping; a row with jobs gets a fresh bucket every snapshot.
export function useRowJobs(course: string, ref: string): readonly JobProgress[] {
  useProviderGuard()
  return useSyncExternalStore(
    subscribe,
    useCallback(() => jobsForRef(jobsByRef, course, ref), [course, ref]),
  )
}

// The whole map, for the bulk-queue summary — it re-derives every target's status from the current
// snapshot, so re-rendering it on every snapshot is the correct scope, not a leak.
export function useJobsByRef(): JobsByRef {
  useProviderGuard()
  return useSyncExternalStore(subscribe, () => jobsByRef)
}

// Whether a download is still writing into this course — a non-terminal job, or a section run still
// walking it. Boolean snapshots, so a ping re-renders only the courses whose answer flipped.
export function useCourseDownloading(course: string): boolean {
  useProviderGuard()
  const jobActive = useSyncExternalStore(subscribe, () => activeCourses.has(course))
  const runActive = useCourseRunActive(course)
  return jobActive || runActive
}

// Reflects the downloader server's jobs: each contentless `job:change` ping refetches `GET /jobs`,
// trusted as-is. See docs/JOBS.md.
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
          const failure = job.message
            ? { message: job.message, code: job.code, params: job.params }
            : null
          toastJobError(job.lecture || 'recording', failure)
          toastedIds.current.add(job.id)
        }
      }
      primed.current = true
      publish(snap)
    }
    // Sequenced: an older reply landing after the final `done` ping would republish the job as
    // `running` with nothing left to correct it.
    const onJobsChanged = sequencedRefresh(fetchJobs, handleSnapshot)
    const close = subscribeJobs(onJobsChanged)
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
