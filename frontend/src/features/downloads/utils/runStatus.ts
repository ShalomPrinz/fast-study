import { plural } from '@lingui/core/macro'
import type { Course } from '@/types'
import type { JobProgress, JobsByRef } from '../contexts/DownloadJobsContext'
import { jobsForRef } from '../contexts/DownloadJobsContext'
import type { RunTarget } from '../services/downloadServer'
import { targetLanded } from './existingItems'

// `unsupported` is a permanent verdict, not a run failure; `pending` is a row the queue has not
// reached, where no job means "not started". See docs/BULK.md.
export type TargetStatus =
  'downloaded' | 'failed' | 'unsupported' | 'skipped' | 'in-flight' | 'pending'

// This target's jobs: ref- and name-scoped (`name`, `name.1`, `name.2`), since a row renamed between
// runs leaves the old name's jobs under the same ref.
function jobsForTarget(jobsByRef: JobsByRef, target: RunTarget): readonly JobProgress[] {
  const names = new Set([target.name, `${target.name}.1`, `${target.name}.2`])
  return jobsForRef(jobsByRef, target.ref).filter((j) => names.has(j.title))
}

// One target's outcome, derived on every render: running job, then tree, then `error` job, else
// still going. The order's reasoning is in docs/BULK.md §Deriving the outcome.
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

// Targets with a running job. Positive evidence only: `targetStatus`'s "still going" fallback never
// expires, so as a busy signal it could hold the section forever.
export function runningCount(targets: readonly RunTarget[], jobsByRef: JobsByRef): number {
  return targets.filter((t) => jobsForTarget(jobsByRef, t).some((j) => j.status === 'running'))
    .length
}

// Triggered targets with no job and nothing in the tree — causes outside the run. Meaningful only
// once the run has stopped. See docs/BULK.md.
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

// Targets the queue never reached. A run that walks to the end decides every row, so a `pending` row
// left once the run has stopped is proof it stopped early — a 401, a cancel, or an abandoned run.
export function notStartedCount(targets: readonly RunTarget[]): number {
  return targets.filter((t) => t.disposition === 'pending').length
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
  const parts = [plural(count('downloaded'), { other: '# downloaded' })]
  if (count('failed')) parts.push(plural(count('failed'), { other: '# failed' }))
  if (count('unsupported')) parts.push(plural(count('unsupported'), { other: '# unsupported' }))
  if (count('skipped')) parts.push(plural(count('skipped'), { other: '# already there' }))
  return parts.join(', ')
}
