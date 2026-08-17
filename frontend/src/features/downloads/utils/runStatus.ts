import type { Course } from '@/types'
import type { JobProgress, JobsByRef } from '../contexts/DownloadJobsContext'
import { jobsForRef } from '../contexts/DownloadJobsContext'
import type { RunTarget } from '../services/downloadServer'
import { targetLanded } from './existingItems'

// `unsupported` is kept apart from `failed`: nothing went wrong with the run, the file just isn't one
// auto can fetch — and unlike a failure it is a permanent verdict the next run skips outright.
// `pending` is a row the queue has not reached: no evidence about it means "not started", not
// "in flight" — the run holds its whole queue from the start, so absence of a job proves nothing.
export type TargetStatus =
  'downloaded' | 'failed' | 'unsupported' | 'skipped' | 'in-flight' | 'pending'

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
  if (target.disposition === 'pending') return 'pending'
  if (target.disposition === 'skipped') return 'skipped'
  if (target.disposition === 'unsupported') return 'unsupported'
  if (target.disposition === 'queue-failed') return 'failed'
  const jobs = jobsForTarget(jobsByRef, target)
  if (jobs.some((j) => j.status === 'running')) return 'in-flight'
  if (targetLanded(target, courses, course)) return 'downloaded'
  if (jobs.some((j) => j.status === 'error')) return 'failed'
  return 'in-flight'
}

// Targets actually downloading right now. Positive evidence only — a job of theirs is running —
// which is the same rule a single row's own button uses, and the reason the section can never be
// held busy by a row nothing is working on. `targetStatus`'s "no evidence yet" fallback deliberately
// has no part in this: it is an honest answer for the summary, but as a busy signal it never expires.
export function runningCount(targets: readonly RunTarget[], jobsByRef: JobsByRef): number {
  return targets.filter((t) => jobsForTarget(jobsByRef, t).some((j) => j.status === 'running'))
    .length
}

// Targets the run can no longer say anything about: it triggered them, no job is left to speak for
// them, and nothing under their name is in the tree. The causes are all outside the run — the
// lecture was deleted or renamed, the name desynced from disk, or the tree is unreachable — so the
// section says so rather than counting them as downloaded or failed. Only meaningful once the run
// has stopped; while it runs this is just the window before the evidence arrives.
export function unverifiedCount(
  targets: readonly RunTarget[],
  courses: Course[],
  course: string,
  jobsByRef: JobsByRef,
): number {
  return targets.filter(
    (t) =>
      t.disposition === 'queued' &&
      jobsForTarget(jobsByRef, t).length === 0 &&
      !targetLanded(t, courses, course),
  ).length
}

// The section header's line. In-flight and not-yet-reached targets are counted nowhere — the header
// shows the queue's own progress before it falls through to this.
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
