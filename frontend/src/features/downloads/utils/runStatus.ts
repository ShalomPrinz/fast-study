import type { Course } from '@/types'
import type { JobProgress, JobsByRef } from '../contexts/DownloadJobsContext'
import { jobsForRef } from '../contexts/DownloadJobsContext'
import type { RunTarget } from '../contexts/DownloadsSessionContext'
import { targetLanded } from './existingItems'

// `unsupported` is kept apart from `failed`: nothing went wrong with the run, the file just isn't one
// auto can fetch — and unlike a failure it is a permanent verdict the next run skips outright.
export type TargetStatus = 'downloaded' | 'failed' | 'unsupported' | 'skipped' | 'in-flight'

// This target's jobs. A job is keyed by lecture name and the target by ref, so a row renamed between
// runs leaves the old name's jobs under the same ref — they are not this target's outcome.
// A zoom share queued as `name` runs as `name.1`/`.2`, so both split names belong to it.
function jobsForTarget(jobsByRef: JobsByRef, target: RunTarget): readonly JobProgress[] {
  const names = new Set([target.name, `${target.name}.1`, `${target.name}.2`])
  return jobsForRef(jobsByRef, target.ref).filter((j) => names.has(j.title))
}

// One target's outcome, derived on every render rather than accumulated: a running job wins outright
// (a zoom pair's second clip is still going even once the first landed), then the course tree owns the
// durable "downloaded" state and outranks an `error` job left by an earlier attempt. An `error` job is
// never time-evicted and a retry supersedes it, so it is evidence of the latest attempt failing.
// Nothing at all means the download is still going — which also covers the window right after the
// POST, before `/jobs` catches up.
export function targetStatus(
  target: RunTarget,
  courses: Course[],
  course: string,
  jobsByRef: JobsByRef,
): TargetStatus {
  if (target.disposition === 'skipped') return 'skipped'
  if (target.disposition === 'unsupported') return 'unsupported'
  if (target.disposition === 'queue-failed') return 'failed'
  const jobs = jobsForTarget(jobsByRef, target)
  if (jobs.some((j) => j.status === 'running')) return 'in-flight'
  if (targetLanded(target, courses, course)) return 'downloaded'
  if (jobs.some((j) => j.status === 'error')) return 'failed'
  return 'in-flight'
}

// The section header's line. In-flight targets are counted nowhere — the header shows them as their
// own state before it falls through to this.
export function summarize(
  targets: readonly RunTarget[],
  courses: Course[],
  course: string,
  jobsByRef: JobsByRef,
): string {
  const status = targets.map((t) => targetStatus(t, courses, course, jobsByRef))
  const count = (s: TargetStatus) => status.filter((x) => x === s).length
  const parts = [`${count('downloaded')} downloaded`]
  if (count('failed')) parts.push(`${count('failed')} failed`)
  if (count('unsupported')) parts.push(`${count('unsupported')} unsupported`)
  if (count('skipped')) parts.push(`${count('skipped')} already there`)
  return parts.join(', ')
}
