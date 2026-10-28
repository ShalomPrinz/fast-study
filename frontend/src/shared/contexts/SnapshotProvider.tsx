import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { t } from '@lingui/core/macro'
import type { Course, RunnerStatus, InFlightEntry, Kind, RunError, RunKind } from '@/types'
import { runAll, fetchRunnerStatus } from '@/services/backend'
import { fetchTree } from '@/services/database'
import { isConnectionError } from '@/services/http'
import { toast } from '@/services/toaster'
import { inFlightKey, parseInFlightKey } from '@/shared/utils/inFlightKey'
import { isQuotaError } from '@/shared/utils/runError'
import { failureId, type ServiceFailure } from '@/shared/i18n/serviceErrors'
import { serviceErrorNode } from '@/shared/components/ServiceError'
import LectureLead, { AssignmentLead } from '@/shared/components/LectureLead'
import { announceNotices } from '@/shared/utils/notices'
import { failureNode } from '@/shared/utils/failure'
import { useReportOnce } from '@/shared/hooks/useReportOnce'
import { useNotify } from '@/shared/hooks/useNotify'
import { useNewestRequest } from '@/shared/hooks/useLatestRequest'
import { sortLectures } from '@/features/lectures/utils/lectureSort'
import { announcePdfWarnings } from '@/features/lectures/utils/pdfWarnings'
import { CourseTreeContext } from './CourseTreeContext'
import { RunnerStatusContext, type UpdateKind } from './RunnerStatusContext'

interface ProviderProps {
  sendUpdate?: (kind: UpdateKind, message: ReactNode) => void
  children: ReactNode
}

// Refetches `/status` and `/tree` as one pair applied in one render, so a page combining them never
// shows one fresh beside the other stale — a finished step's button back, /running re-listing it.
export function SnapshotProvider({ sendUpdate, children }: ProviderProps) {
  const [status, setStatus] = useState<RunnerStatus | null>(null)
  const [courses, setCourses] = useState<Course[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)

  const sendUpdateRef = useRef(sendUpdate)
  useEffect(() => {
    sendUpdateRef.current = sendUpdate
  }, [sendUpdate])
  const {
    report: reportError,
    seed: seedError,
    prune: pruneErrors,
  } = useReportOnce<ReactNode>((node) => sendUpdateRef.current?.('error', node))
  // PDF render warnings ride the tree, so they are announced from it rather than from /status.
  const warningReports = useReportOnce((msg) => toast('warning', msg))

  // Any pair newer than the one shown lands, even with a newer fetch in flight: a notify stream
  // would otherwise drop every answer until it pauses.
  const newest = useNewestRequest()
  const issued = useRef(0)
  // The first applied status and tree carry errors and warnings from before load: seed-and-suppress them.
  const statusPrimed = useRef(false)
  const treePrimed = useRef(false)
  // Lectures whose run this window started, each with the last refresh id issued before the `started`
  // answer: the backend clears the old error before it serves any later request, so only those may hold it.
  const startedAt = useRef(new Map<string, number>())
  // `refreshUntil` callers, each told of every applied tree; one returns true once it is satisfied.
  const treeWaiters = useRef(new Set<(courses: Course[]) => boolean>())

  function applyStatus(fetched: RunnerStatus, id: number) {
    let s = fetched
    for (const [key, at] of startedAt.current) {
      if (id > at) startedAt.current.delete(key)
      else s = withoutError(s, key)
    }
    setStatus(s)
    const validKeys = new Set(Object.keys(s.errors))
    validKeys.add('runner-crash')
    pruneErrors(validKeys)
    // A toast shows on any page, so it names the lecture its key holds; the runner crash names its own.
    const lectureLead = (key: string) => {
      const parsed = parseInFlightKey(key)
      if (!parsed) return undefined
      return parsed.kind === 'assignment' ? (
        <AssignmentLead course={parsed.course} assignment={parsed.lecture} />
      ) : (
        <LectureLead course={parsed.course} lecture={parsed.lecture} />
      )
    }
    const announce = (key: string, failure: ServiceFailure) =>
      statusPrimed.current
        ? reportError(key, failureId(failure), serviceErrorNode(failure, lectureLead(key)))
        : seedError(key, failureId(failure))
    if (!s.runner.running && s.runner.lastError) {
      announce('runner-crash', s.runner.lastError)
    }
    // A quota toasts only on the lecture that hit the limit; the ones run-all then stopped at
    // summarize are `blocked`, or one batch would toast the same sentence once per lecture.
    for (const [key, error] of Object.entries(s.errors)) {
      if (isQuotaError(error.code) && error.blocked) continue
      announce(key, error)
    }
    announceNotices('runner', s.notices)
    statusPrimed.current = true
  }

  // Either side may fail alone: the other still applies, so a backend that is down never freezes the
  // tree, nor a failed /tree the runner state. The failure itself was toasted by the http client.
  async function refresh() {
    const id = ++issued.current
    const pair = await newest(Promise.allSettled([fetchRunnerStatus(), fetchTree()]))
    // Overtaken by a pair already shown.
    if (!pair) return
    const [s, c] = pair
    if (s.status === 'fulfilled') applyStatus(s.value, id)
    if (c.status === 'fulfilled') {
      setCourses(c.value)
      for (const w of treeWaiters.current) if (w(c.value)) treeWaiters.current.delete(w)
      announcePdfWarnings(c.value, warningReports, treePrimed.current)
      treePrimed.current = true
      setLoaded(true)
      setLoadFailed(false)
    } else if (id === issued.current) {
      // Only the newest fetch's failure settles `loaded`, or routes would flash "not found" before a newer
      // tree lands; settling it beats spinning forever behind a database service that is down.
      setLoaded(true)
      setLoadFailed(true)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  // Settling in the same task as `setCourses` lets the caller's navigation commit in that tree's render,
  // even when a notify's refetch lands it first; the refetch's own settling ends the wait regardless.
  async function refreshUntil(has: (courses: Course[]) => boolean) {
    let waiter!: (courses: Course[]) => boolean
    const landed = new Promise<void>((resolve) => {
      waiter = (courses) => {
        if (!has(courses)) return false
        resolve()
        return true
      }
    })
    treeWaiters.current.add(waiter)
    try {
      await Promise.race([landed, refresh()])
    } finally {
      treeWaiters.current.delete(waiter)
    }
  }

  useNotify(refresh)

  async function trigger() {
    try {
      const s = await runAll()
      if (s === 'empty_queue') {
        sendUpdateRef.current?.('info', t`Nothing to run - All pipelines complete`)
        return
      }
      if (s === 'all_in_flight') {
        sendUpdateRef.current?.('info', t`Nothing to run - All remaining pipelines already running`)
        return
      }
      setStatus(s)
    } catch (err) {
      if (isConnectionError(err)) return // already toasted centrally by the http client
      sendUpdateRef.current?.('error', failureNode(err))
    }
  }

  // A previous attempt's error would otherwise read as this run's outcome until a refresh shows it gone,
  // and a start-to-failure too quick for any refresh to see would leave an identical new error unannounced.
  function markStarted(course: string, lecture: string, kind: RunKind) {
    const key = inFlightKey(course, lecture, kind)
    startedAt.current.set(key, issued.current)
    pruneErrors(new Set(), (k) => k === key)
    setStatus((prev) => prev && withoutError(prev, key))
    void refresh()
  }

  function isInFlight(course: string, lecture: string, kind: Kind): boolean {
    const key = inFlightKey(course, lecture, kind)
    return status?.inFlight.some((e) => inFlightKey(e.course, e.lecture, e.kind) === key) ?? false
  }

  function getInFlight(course: string, lecture: string, kind: Kind): InFlightEntry | null {
    const key = inFlightKey(course, lecture, kind)
    return status?.inFlight.find((e) => inFlightKey(e.course, e.lecture, e.kind) === key) ?? null
  }

  function getError(course: string, lecture: string, kind: Kind): RunError | null {
    return status?.errors[inFlightKey(course, lecture, kind)] ?? null
  }

  function getAssignmentRun(course: string, assignment: string): InFlightEntry | null {
    const key = inFlightKey(course, assignment, 'assignment')
    return status?.inFlight.find((e) => inFlightKey(e.course, e.lecture, e.kind) === key) ?? null
  }

  function getAssignmentError(course: string, assignment: string): RunError | null {
    return status?.errors[inFlightKey(course, assignment, 'assignment')] ?? null
  }

  // The database lists courses in raw directory order, so every consumer gets them by name here.
  const sortedCourses = useMemo(
    () =>
      courses
        .map((c) => ({
          ...c,
          lectures: sortLectures(c.lectures),
          recitations: sortLectures(c.recitations),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [courses],
  )

  return (
    <CourseTreeContext.Provider
      value={{ courses: sortedCourses, loaded, loadFailed, refreshCourses: refresh, refreshUntil }}
    >
      <RunnerStatusContext.Provider
        value={{
          status,
          trigger,
          isInFlight,
          getInFlight,
          getError,
          getAssignmentRun,
          getAssignmentError,
          markStarted,
        }}
      >
        {children}
      </RunnerStatusContext.Provider>
    </CourseTreeContext.Provider>
  )
}

function withoutError(s: RunnerStatus, key: string): RunnerStatus {
  if (!(key in s.errors)) return s
  const errors = { ...s.errors }
  delete errors[key]
  return { ...s, errors }
}
