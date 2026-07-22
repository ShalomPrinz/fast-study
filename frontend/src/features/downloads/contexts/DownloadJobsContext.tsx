import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { DownloadOperation } from '@/types'
import type { DownloadJob } from '../services/downloadServer'
import { fetchJobs, subscribeJobs } from '../services/downloadServer'
import { toastJobError } from '../utils/downloadErrors'

// One download job as the display atom for a titled ETA bar
export interface JobProgress {
  id: string
  title: string
  status: 'running' | 'done' | 'error'
  startedAt: number | null
  expectedBytes: number | null
  operation: DownloadOperation | null
}

interface DownloadJobsValue {
  progressOf: (ref: string) => JobProgress[]
}

const DownloadJobsContext = createContext<DownloadJobsValue | null>(null)

function isTerminal(job: DownloadJob): boolean {
  return job.status === 'done' || job.status === 'error'
}

// The whole-row aggregate the Download/Retry button and the section summary share: running if any
// job is non-terminal, else error if any failed, else done, else null (no jobs). Retry-if-any-failed.
export function rowStatus(jobs: JobProgress[]): 'running' | 'done' | 'error' | null {
  if (!jobs.length) return null
  if (jobs.some((j) => j.status === 'running')) return 'running'
  if (jobs.some((j) => j.status === 'error')) return 'error'
  return 'done'
}

// One EventSource for the page, against the downloader server (:3052) which owns the jobs.
// The stream is a contentless `job:change` ping; every ping refetches `GET /jobs`.
// A `ref` groups the row, while its jobs are the display atoms. See docs/DOWNLOADS.md.
export function DownloadJobsProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<DownloadJob[]>([])

  // Ids already toasted, so a failed job toasts once.
  // `primed` guards the first snapshot: its errors are history from before load and must not toast.
  const toastedIds = useRef<Set<string>>(new Set())
  const primed = useRef(false)

  const handleSnapshot = useCallback((snap: DownloadJob[]) => {
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
    setJobs(snap)
  }, [])

  useEffect(() => {
    // A failed fetch is a no-op; the stream reconnects and pings again.
    const refresh = () => { void fetchJobs().then(handleSnapshot).catch(() => {}) }
    return subscribeJobs(refresh)
  }, [handleSnapshot])

  const progressOf = useCallback((ref: string): JobProgress[] => {
    // Note: `startedAt` is the server's epoch ms and the bar measures elapsed against the browser's
    // `Date.now()` — this assumes both clocks agree; skew renders as an overflowed bar.
    return jobs
      .filter((j) => j.ref === ref)
      .sort((a, b) => a.lecture.localeCompare(b.lecture) || a.id.localeCompare(b.id))
      .map((j) => ({
        id: j.id,
        title: j.lecture,
        status: isTerminal(j) ? (j.status as 'done' | 'error') : 'running',
        startedAt: j.startedAt,
        expectedBytes: j.expectedBytes,
        operation: j.operation,
      }))
  }, [jobs])

  const value = useMemo(() => ({ progressOf }), [progressOf])
  return <DownloadJobsContext.Provider value={value}>{children}</DownloadJobsContext.Provider>
}

export function useDownloadJobs(): DownloadJobsValue {
  const ctx = useContext(DownloadJobsContext)
  if (!ctx) throw new Error('useDownloadJobs must be used inside <DownloadJobsProvider>')
  return ctx
}
