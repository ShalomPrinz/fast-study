import { plural } from '@lingui/core/macro'
import type { Course, Kind } from '@/types'
import type { JobProgress, JobsByRef } from '../contexts/DownloadJobsContext'
import { jobsForRef, jobsForTarget } from '../contexts/DownloadJobsContext'
import type { Item } from '../services/autoDownloader'
import type { RunTarget, SectionRun } from '../services/downloadServer'
import { targetLanded } from './existingItems'

// `unsupported` is a permanent verdict, not a run failure; `pending` is a row the queue has not
// reached, where no job means "not started". See docs/BULK.md.
export type TargetStatus =
  'downloaded' | 'failed' | 'cancelled' | 'unsupported' | 'skipped' | 'in-flight' | 'pending'

// This target's jobs: course-, ref-, name- and kind-scoped.
function targetJobs(
  jobsByRef: JobsByRef,
  course: string,
  target: RunTarget,
): readonly JobProgress[] {
  return jobsForTarget(jobsForRef(jobsByRef, course, target.ref), target.name, target.kind)
}

// A queue leaf as a target, before its disposition: the row's resolved name and kind, its best-known
// media, and auto's `moodle` flag, which lets the server fail later Moodle rows after a captcha timeout.
export function targetOf(item: Item, name: string, kind: Kind): Omit<RunTarget, 'disposition'> {
  return { ref: item.ref, name, kind, media: item.resolvedMedia ?? item.media, moodle: item.moodle }
}

// Names two or more about-to-download video targets share. They would race into one lecture, the
// later PUT replacing the earlier, so a run holding any is refused. A material adds to its lecture
// and an assignment file lands beside its siblings in the named folder, so neither collides.
export function collidingNames(targets: readonly RunTarget[]): string[] {
  const seen = new Set<string>()
  const clashes = new Set<string>()
  for (const t of targets) {
    if (t.disposition !== 'pending' || t.media === 'material' || t.media === 'assignment') continue
    const key = `${t.kind}\0${t.name}`
    if (seen.has(key)) clashes.add(t.name)
    else seen.add(key)
  }
  return [...clashes]
}

// One target's outcome, derived on every render: running job, then tree, then `error` job, then
// `cancelled` job, else still going. The order's reasoning is in docs/BULK.md §Deriving the outcome.
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
  const jobs = targetJobs(jobsByRef, course, target)
  if (jobs.some((j) => j.status === 'running')) return 'in-flight'
  if (targetLanded(target, courses, course)) return 'downloaded'
  if (jobs.some((j) => j.status === 'error')) return 'failed'
  if (jobs.some((j) => j.status === 'cancelled')) return 'cancelled'
  return 'in-flight'
}

// Targets with a running job. Positive evidence only: `targetStatus`'s "still going" fallback never
// expires, so as a busy signal it could hold the section forever.
export function runningCount(
  targets: readonly RunTarget[],
  course: string,
  jobsByRef: JobsByRef,
): number {
  return targets.filter((t) => targetJobs(jobsByRef, course, t).some((j) => j.status === 'running'))
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
      targetJobs(jobsByRef, course, t).length === 0 &&
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
  if (count('cancelled')) parts.push(plural(count('cancelled'), { other: '# cancelled' }))
  if (count('unsupported')) parts.push(plural(count('unsupported'), { other: '# unsupported' }))
  if (count('skipped')) parts.push(plural(count('skipped'), { other: '# already there' }))
  return parts.join(', ')
}

// A run's header facts: `queueing` is the server's status, and `busy` ORs in the live jobs, which
// outlive the queue (docs/BULK.md §Deriving the outcome).
export interface BulkRunState {
  queueing: boolean
  // Targets with a running job.
  active: number
  busy: boolean
  // Rows a stopped run can no longer account for, and rows it never reached; zero while queueing.
  stalled: number
  notStarted: number
  // Rows failed on an unsolved captcha; counted while queueing too, as the summary only says "failed".
  captchaTimedOut: number
}

export function bulkRunState(
  run: SectionRun | null,
  courses: Course[],
  course: string,
  jobsByRef: JobsByRef,
): BulkRunState {
  const targets = run?.targets ?? []
  const queueing = run?.status === 'running' || run?.status === 'paused'
  const active = runningCount(targets, course, jobsByRef)
  return {
    queueing,
    active,
    busy: queueing || active > 0,
    stalled: queueing ? 0 : unverifiedCount(targets, courses, course, jobsByRef),
    notStarted: queueing ? 0 : notStartedCount(targets),
    captchaTimedOut: captchaTimeoutCount(targets),
  }
}

// Whether a run still holds its recordings: its queue is walking, or a download it started is running.
export function runBusy(run: SectionRun, course: string, jobsByRef: JobsByRef): boolean {
  return (
    run.status === 'running' ||
    run.status === 'paused' ||
    runningCount(run.targets, course, jobsByRef) > 0
  )
}

// Whether any of these runs (a section's playlists, this course's course run) still holds its rows.
export function anyRunBusy(
  runs: readonly (SectionRun | null)[],
  course: string,
  jobsByRef: JobsByRef,
): boolean {
  return runs.some((run) => run !== null && runBusy(run, course, jobsByRef))
}

// Why "Download all" can't start, first reason wins; a busy run has no tooltip, its label says so.
// `otherBusy` is the other run over the same rows (section vs playlist), which would download them twice.
export function bulkGate(args: {
  ready: boolean
  busy: boolean
  otherBusy: boolean
  locked: boolean
}): { disabled: boolean; reason: 'expand' | 'other-run' | 'moodle' | null } {
  const { ready, busy, otherBusy, locked } = args
  const reason = !ready
    ? 'expand'
    : busy
      ? null
      : otherBusy
        ? 'other-run'
        : locked
          ? 'moodle'
          : null
  return { disabled: busy || reason !== null, reason }
}

// Targets the run failed because the site's captcha went unsolved — the row that waited and every
// later Moodle row, which the run never sent. See docs/BULK.md.
export function captchaTimeoutCount(targets: readonly RunTarget[]): number {
  return targets.filter((t) => t.code === 'site_captcha_timeout').length
}
