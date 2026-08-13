import type { JobProgress, JobsByRef } from '../contexts/DownloadJobsContext'
import { jobsForRef, rowStatus } from '../contexts/DownloadJobsContext'

// `started` holds refs, not a count: a queued download's real outcome lives in its jobs, so the
// summary is derived from them rather than tallied at queue time.
export interface Tally {
  started: string[]
  failed: number
  skipped: number
  // Counted apart from `failed`: nothing went wrong with the run, the file just isn't one auto can
  // fetch — and unlike a failure it is a permanent verdict the next run skips outright.
  unsupported: number
}

// A started row counts as failed if any of its jobs failed. `started` is one job list per queued ref.
export function summarize(tally: Tally, started: readonly (readonly JobProgress[])[]): string {
  const status = started.map(rowStatus)
  const failed = tally.failed + status.filter((s) => s === 'error').length
  const parts = [`${status.filter((s) => s === 'done').length} downloaded`]
  if (failed) parts.push(`${failed} failed`)
  if (tally.unsupported) parts.push(`${tally.unsupported} unsupported`)
  if (tally.skipped) parts.push(`${tally.skipped} already there`)
  return parts.join(', ')
}

// When a run's downloads are all over, so its summary can be frozen. A ref with no jobs is not
// settled: `/jobs` lags the POST that queued it, and reading that gap as "done" would freeze a zero.
export function runSettled(started: readonly string[], byRef: JobsByRef): boolean {
  return started.every((ref) => {
    const jobs = jobsForRef(byRef, ref)
    return jobs.length > 0 && rowStatus(jobs) !== 'running'
  })
}
