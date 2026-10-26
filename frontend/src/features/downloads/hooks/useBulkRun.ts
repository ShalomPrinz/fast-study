import { useEffect, useRef, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import type { Course, RunnerStatus } from '@/types'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { useRunnerStatus } from '@/shared/contexts/RunnerStatusContext'
import { isLectureRenameLocked } from '@/features/lectures/utils/renameLock'
import { toast } from '@/services/toaster'
import type { Item } from '@/features/downloads/services/autoDownloader'
import { saveZoomPasscode } from '@/features/downloads/services/autoDownloader'
import type { RunTarget, SectionRun } from '@/features/downloads/services/downloadServer'
import { cancelRun, resumeRun, startSectionRun } from '@/features/downloads/services/downloadServer'
import { useJobsByRef } from '@/features/downloads/contexts/DownloadJobsContext'
import type { RowEdit, RowLock } from '@/features/downloads/contexts/RowEditsContext'
import { resolveRow, useRowEditsDispatch } from '@/features/downloads/contexts/RowEditsContext'
import { useSectionRun } from '@/features/downloads/contexts/SectionRunsContext'
import { useWithMoodleLock } from '@/features/downloads/contexts/MoodleLockContext'
import { useResolveMedia } from '@/features/downloads/contexts/ResolvedMediaContext'
import {
  hasResource,
  overwritesVideo,
  splitSiblings,
} from '@/features/downloads/utils/existingItems'
import type { BulkRunState } from '@/features/downloads/utils/runStatus'
import {
  bulkRunState,
  collidingNames,
  summarize,
  targetOf,
} from '@/features/downloads/utils/runStatus'
import { toastDownloadError } from '@/features/downloads/utils/downloadErrors'
import { applyRenames } from '@/features/downloads/utils/renames'
import { startAndLock } from '@/features/downloads/utils/rowLocks'

export interface BulkRun {
  run: SectionRun | null
  // The run's derived facts, plus the finished run's summary line (null until it has one to show).
  state: BulkRunState & { summary: string | null }
  // Submits these leaves as the run; `gated` sends it through the Moodle lock.
  start: (queue: Item[], gated: boolean) => Promise<void>
  passcode: {
    saving: boolean
    submit: (passcode: string, scope: 'course' | 'lecture') => Promise<void>
    cancel: () => Promise<void>
  }
}

// One "Download all" — a section's or a playlist's — keyed by its run key (null: no run). Starts the
// run, then only reflects it; see docs/BULK.md.
export function useBulkRun(runKey: string | null, course: string, label: string): BulkRun {
  const { t } = useLingui()
  const { courses } = useCourseTreeContext()
  const jobsByRef = useJobsByRef()
  const { status: runner } = useRunnerStatus()
  const resolveMedia = useResolveMedia()
  // The server's canonical spelling replaces each renamed row's name, so the skip rule and the run's
  // landed check compare against disk.
  const { setName, lock, read } = useRowEditsDispatch()
  const withMoodleLock = useWithMoodleLock()
  const run = useSectionRun(runKey)
  // The passcode save's own in-flight state — the only thing about a run this hook still owns.
  // A double submit is the server's to reject (409 on a run that is no longer parked).
  const [saving, setSaving] = useState(false)
  // Refs whose resolved type has already been reported upward (below).
  const reported = useRef<Set<string>>(new Set())
  const targets = run?.targets
  const paused = run?.status === 'paused' ? run.paused : null

  // The run's verdicts resolve 'unknown' rows as a single download's answer does — reported once
  // per ref, since every ping re-reads the same targets.
  useEffect(() => {
    for (const target of targets ?? []) {
      if (
        target.media === 'unknown' ||
        target.media === 'material' ||
        target.media === 'assignment' ||
        reported.current.has(target.ref)
      )
        continue
      if (target.disposition !== 'queued' && target.disposition !== 'unsupported') continue
      reported.current.add(target.ref)
      resolveMedia(target.ref, target.media)
    }
  }, [targets, resolveMedia])

  async function start(queue: Item[], gated: boolean) {
    if (!runKey) return
    const built = buildTargets(queue, { ...read(), courses, course, runner })
    if (!built.length) return
    // Refused rather than deduped: which row should own the name is the user's call.
    const clashes = collidingNames(built)
    if (clashes.length) {
      const names = clashes.join(', ')
      toast(
        'error',
        t`Several rows would download into the same lecture (${names}). Rename them, then run again.`,
      )
      return
    }
    const post = () => startSectionRun({ sectionId: runKey, course, targets: built })
    try {
      const renames = await startAndLock(
        () => (gated ? withMoodleLock(post) : post()),
        built,
        course,
        lock,
      )
      applyRenames(renames, built, setName)
    } catch (err) {
      toastDownloadError(label, err)
    }
  }

  // Save the passcode through auto (the passcode store stays there), then let the server resume the
  // same row. A failed save gives up on that one row and continues from the next.
  async function submit(passcode: string, scope: 'course' | 'lecture') {
    if (!run || !paused || !passcode || saving) return
    setSaving(true)
    let failed = false
    try {
      await saveZoomPasscode({ course, name: paused.name, passcode, scope })
    } catch {
      failed = true
    }
    try {
      await resumeRun(run.id, failed)
    } catch {
      // A resume the server refused (409: no longer parked) needs nothing from here — the next
      // `run:change` says what the run actually did.
    }
    setSaving(false)
  }

  // Cancelling abandons the rest of the queue and stops the downloads the run already started.
  async function cancel() {
    if (!run) return
    try {
      await cancelRun(run.id)
    } catch (err) {
      toastDownloadError(label, err)
    }
  }

  const derived = bulkRunState(run, courses, course, jobsByRef)
  const summary =
    !derived.queueing && derived.active === 0 && targets?.length
      ? summarize(targets, courses, course, jobsByRef)
      : null
  return { run, state: { ...derived, summary }, start, passcode: { saving, submit, cancel } }
}

// The queue, resolved once at submit, with the verdicts only the page can give because they read
// the live tree or the runner: already on disk, already known unsupported, and pipeline-locked.
function buildTargets(
  queue: Item[],
  ctx: {
    edits: Record<string, RowEdit>
    locks: Record<string, RowLock>
    courses: Course[]
    course: string
    runner: RunnerStatus | null
  },
): RunTarget[] {
  const { edits, locks, courses, course, runner } = ctx
  return queue.map((item) => {
    const { name, kind } = resolveRow(item, edits[item.ref], courses, course, locks[item.ref])
    const target = targetOf(item, name, kind)
    const { media } = target
    if (item.resolvedMedia === 'unsupported') return { ...target, disposition: 'unsupported' }
    // The lectures this target may write — a video's split siblings too, as the row's own lock.
    // An assignment file lands in no lecture, so the pipeline never locks it.
    const lands =
      media === 'assignment'
        ? []
        : media === 'material'
          ? [name]
          : [name, ...splitSiblings(name, kind, courses, course)]
    // A run never overwrites, so a target that would replace a stored video is skipped too — and so
    // is one whose lecture the pipeline is running or queued on, as a single row refuses it.
    if (
      hasResource(item, name, kind, courses, course) ||
      overwritesVideo(item, name, kind, courses, course) ||
      lands.some((n) => isLectureRenameLocked(runner, course, n, kind))
    )
      return { ...target, disposition: 'skipped' }
    return { ...target, disposition: 'pending' }
  })
}
