import type { JobsByRef } from '../contexts/DownloadJobsContext'
import { jobsForRef, rowStatus } from '../contexts/DownloadJobsContext'

// Only the rows a run settled without queuing anything: a queued download's real outcome lives in
// its jobs, so those are folded from the run's started refs rather than tallied at queue time.
export interface Tally {
  failed: number
  skipped: number
  // Counted apart from `failed`: nothing went wrong with the run, the file just isn't one auto can
  // fetch — and unlike a failure it is a permanent verdict the next run skips outright.
  unsupported: number
}

// A started ref's terminal outcome plus the ids it was read from. The ids are what lets a later
// attempt on that ref supersede the verdict, while an eviction — which only removes ids — cannot.
export interface Verdict {
  status: 'done' | 'error'
  jobIds: readonly string[]
}

// Each started ref's terminal outcome, once observed. Accumulated snapshot by snapshot rather than
// re-derived at the end, because the download server evicts a `done` job 60s later: in a run whose
// downloads finish more than a minute apart, the earliest rows are gone by the time the last settles.
export type Verdicts = Readonly<Record<string, Verdict>>

// Per started ref, the ids of the jobs it already had when the run triggered it. Those are a
// pre-existing run's leftovers — the server never time-evicts an `error` job — and the snapshot the
// browser holds still lags the POST, so without this baseline a retry reads the old verdict as its own.
export type StaleJobs = Readonly<Record<string, readonly string[]>>

// Folds this `/jobs` snapshot into `prev`, returning null when it changes nothing. Only jobs outside
// the ref's stale baseline count. A ref with no such jobs (or still running) records nothing: `/jobs`
// lags the POST that queued it, and reading that gap as "done" would freeze a zero. A recorded ref is
// revisited only when a job appears that is in neither its baseline nor its verdict — a new attempt
// (a per-row retry mid-run), which drops the verdict so the run waits for the real outcome. Eviction
// only removes ids, so a ref whose jobs are gone keeps what it recorded.
export function recordVerdicts(
  started: readonly string[],
  byRef: JobsByRef,
  prev: Verdicts,
  staleJobs: StaleJobs,
): Verdicts | null {
  let next: Record<string, Verdict> | null = null
  for (const ref of started) {
    const stale = staleJobs[ref]
    const jobs = jobsForRef(byRef, ref)
    const recorded = prev[ref]
    if (recorded) {
      const superseded = jobs.some((j) => !stale?.includes(j.id) && !recorded.jobIds.includes(j.id))
      if (!superseded) continue
    }
    const fresh = stale?.length ? jobs.filter((j) => !stale.includes(j.id)) : jobs
    const status = rowStatus(fresh)
    if (status !== 'done' && status !== 'error') {
      if (!recorded) continue
      next ??= { ...prev }
      delete next[ref]
      continue
    }
    next ??= { ...prev }
    next[ref] = { status, jobIds: fresh.map((j) => j.id) }
  }
  return next
}

// Whether a run is over: the queue is done and every ref it started has a verdict. The `outcome` gate
// is load-bearing — mid-run every ref triggered so far can transiently have a verdict while items
// remain to trigger, and freezing there would report a summary of a fraction of the section.
export function isRunSettled(
  outcome: Tally | null,
  started: readonly string[],
  verdicts: Verdicts,
): outcome is Tally {
  return outcome !== null && started.every((ref) => verdicts[ref])
}

// A started row counts as failed if any of its jobs failed — that is already what its verdict says.
export function summarize(tally: Tally, started: readonly string[], verdicts: Verdicts): string {
  const status = started.map((ref) => verdicts[ref]?.status)
  const failed = tally.failed + status.filter((s) => s === 'error').length
  const parts = [`${status.filter((s) => s === 'done').length} downloaded`]
  if (failed) parts.push(`${failed} failed`)
  if (tally.unsupported) parts.push(`${tally.unsupported} unsupported`)
  if (tally.skipped) parts.push(`${tally.skipped} already there`)
  return parts.join(', ')
}
