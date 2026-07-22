import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { DownloadOperation } from '@/types'
import type { DownloadJob } from '../services/downloadServer'
import { fetchJobs, subscribeJobs } from '../services/downloadServer'
import { toastJobError } from '../utils/downloadErrors'

// What a row's jobs collapse into. The wire carries no bytes, so `expectedBytes` + `startedAt` +
// `operation` are exactly the inputs the shared ETA bar needs; a null size means nothing to regress on.
export interface RowProgress {
  status: 'running' | 'done' | 'error'
  startedAt: number | null
  expectedBytes: number | null
  operation: DownloadOperation | null
}

interface DownloadJobsValue {
  progressOf: (ref: string) => RowProgress | null
}

const DownloadJobsContext = createContext<DownloadJobsValue | null>(null)

function isTerminal(job: DownloadJob): boolean {
  return job.status === 'done' || job.status === 'error'
}

// One EventSource for the page, against the downloader server (:3052) which owns the jobs.
// The stream is a contentless `job:change` ping; every ping refetches `GET /jobs`.
// Rows group the snapshot by `job.ref` — several could be in flight at once during a bulk run,
// hence a shared store rather than a subscription per row. See docs/DOWNLOADS.md.
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

  const progressOf = useCallback((ref: string): RowProgress | null => {
    // allow many jobs to share a ref, for the zoom double recordings per link.
    // in the future we might add another ref for the second recording and simplify this function.
    const mine = jobs.filter((j) => j.ref === ref)
    if (!mine.length) return null

    const status = mine.some((j) => !isTerminal(j))
      ? 'running'
      : mine.some((j) => j.status === 'error') ? 'error' : 'done'
    // `startedAt` is the server's epoch ms, and the bar measures elapsed against the browser's
    // `Date.now()` — this assumes both clocks agree; skew renders as an overflowed bar.
    const times = mine.map((j) => j.startedAt).filter((t): t is number => t !== null)
    const unknown = mine.some((j) => j.expectedBytes === null)
    return {
      status,
      startedAt: times.length ? Math.min(...times) : null,
      expectedBytes: unknown ? null : mine.reduce((sum, j) => sum + (j.expectedBytes ?? 0), 0),
      operation: mine[0].operation,
    }
  }, [jobs])

  const value = useMemo(() => ({ progressOf }), [progressOf])
  return <DownloadJobsContext.Provider value={value}>{children}</DownloadJobsContext.Provider>
}

export function useDownloadJobs(): DownloadJobsValue {
  const ctx = useContext(DownloadJobsContext)
  if (!ctx) throw new Error('useDownloadJobs must be used inside <DownloadJobsProvider>')
  return ctx
}
