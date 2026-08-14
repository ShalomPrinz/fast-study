import type { Course } from '@/types'
import type { JobsByRef } from '../contexts/DownloadJobsContext'
import { jobsForRef } from '../contexts/DownloadJobsContext'
import type { RunTarget } from '../contexts/DownloadsSessionContext'
import { targetLanded } from './existingItems'

// `unsupported` is kept apart from `failed`: nothing went wrong with the run, the file just isn't one
// auto can fetch — and unlike a failure it is a permanent verdict the next run skips outright.
export type TargetStatus = 'downloaded' | 'failed' | 'unsupported' | 'skipped' | 'in-flight'

// One target's outcome, derived on every render rather than accumulated: the course tree owns the
// durable "downloaded" state, and an `error` job is never time-evicted and is superseded by a retry,
// so it is positive evidence of the latest attempt failing. Absence of both means the download is
// still going — which is also what covers the window right after the POST, before `/jobs` catches up.
export function targetStatus(
  target: RunTarget,
  courses: Course[],
  course: string,
  jobsByRef: JobsByRef,
): TargetStatus {
  if (target.disposition === 'skipped') return 'skipped'
  if (target.disposition === 'unsupported') return 'unsupported'
  if (target.disposition === 'queue-failed') return 'failed'
  if (targetLanded(target, courses, course)) return 'downloaded'
  if (jobsForRef(jobsByRef, target.ref).some((j) => j.status === 'error')) return 'failed'
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
