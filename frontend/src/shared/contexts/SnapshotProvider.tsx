import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { t } from '@lingui/core/macro'
import type { Course, RunnerStatus, InFlightEntry, Kind, RunError } from '@/types'
import { runAll, fetchRunnerStatus } from '@/services/backend'
import { fetchTree } from '@/services/database'
import { isConnectionError } from '@/services/http'
import { toast } from '@/services/toaster'
import { inFlightKey, parseInFlightKey } from '@/shared/utils/inFlightKey'
import { isGeminiQuota } from '@/shared/utils/runError'
import { failureId, type ServiceFailure } from '@/shared/i18n/serviceErrors'
import { serviceErrorNode } from '@/shared/components/ServiceError'
import LectureLead from '@/shared/components/LectureLead'
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

  function applyStatus(s: RunnerStatus) {
    setStatus(s)
    const validKeys = new Set(Object.keys(s.errors))
    validKeys.add('runner-crash')
    pruneErrors(validKeys)
    // A toast shows on any page, so it names the lecture its key holds; the runner crash names its own.
    const lectureLead = (key: string) => {
      const parsed = parseInFlightKey(key)
      return parsed ? <LectureLead course={parsed.course} lecture={parsed.lecture} /> : undefined
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
      if (isGeminiQuota(error.code) && error.blocked) continue
      announce(key, error)
    }
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
    if (s.status === 'fulfilled') applyStatus(s.value)
    if (c.status === 'fulfilled') {
      setCourses(c.value)
      announcePdfWarnings(c.value, warningReports, treePrimed.current)
      treePrimed.current = true
      setLoaded(true)
    } else if (id === issued.current) {
      // Only the newest fetch's failure settles `loaded`, or routes would flash "not found" before a newer
      // tree lands; settling it beats spinning forever behind a database service that is down.
      setLoaded(true)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

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

  const sortedCourses = useMemo(
    () =>
      courses.map((c) => ({
        ...c,
        lectures: sortLectures(c.lectures),
        recitations: sortLectures(c.recitations),
      })),
    [courses],
  )

  return (
    <CourseTreeContext.Provider value={{ courses: sortedCourses, loaded, refreshCourses: refresh }}>
      <RunnerStatusContext.Provider value={{ status, trigger, isInFlight, getInFlight, getError }}>
        {children}
      </RunnerStatusContext.Provider>
    </CourseTreeContext.Provider>
  )
}
