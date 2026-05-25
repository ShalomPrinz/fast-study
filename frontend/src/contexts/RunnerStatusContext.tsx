import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { RunnerStatus, InFlightEntry, Kind } from '../types'
import { runAll, fetchRunnerStatus } from '../services/backend'
import { databaseUrl } from '../services/database'
import { inFlightKey } from '../utils/inFlightKey'


interface RunnerStatusValue {
  status: RunnerStatus | null
  trigger: () => Promise<void>
  isInFlight: (course: string, lecture: string, kind: Kind) => boolean
  getInFlight: (course: string, lecture: string, kind: Kind) => InFlightEntry | null
}

const RunnerStatusContext = createContext<RunnerStatusValue>({
  status: null,
  trigger: async () => {},
  isInFlight: () => false,
  getInFlight: () => null,
})

type ToastKind = 'info' | 'error'

interface ProviderProps {
  sendUpdate?: (kind: ToastKind, message: string) => void
  children: ReactNode
}

export function RunnerStatusProvider({ sendUpdate, children }: ProviderProps) {
  const [status, setStatus] = useState<RunnerStatus | null>(null)
  const lastReportedRunnerCrashRef = useRef<string | null>(null)
  const lastReportedStepErrorsRef = useRef<Set<string>>(new Set())
  const sendUpdateRef = useRef(sendUpdate)
  useEffect(() => { sendUpdateRef.current = sendUpdate }, [sendUpdate])

  function reportRunnerError(err: string | null) {
    if (err && err !== lastReportedRunnerCrashRef.current) {
      lastReportedRunnerCrashRef.current = err
      sendUpdateRef.current?.('error', err)
    }
  }

  function reportPerLectureErrors(s: RunnerStatus) {
    // Clear stale keys so they can fire again on the next run
    const currentKeys = new Set(Object.keys(s.errors))
    for (const k of lastReportedStepErrorsRef.current) {
      if (!currentKeys.has(k)) lastReportedStepErrorsRef.current.delete(k)
    }

    // Send errors update for any new errors that haven't been reported yet
    for (const [key, message] of Object.entries(s.errors)) {
      const token = `${key}:${message}`
      if (!lastReportedStepErrorsRef.current.has(token)) {
        lastReportedStepErrorsRef.current.add(token)
        sendUpdateRef.current?.('error', message)
      }
    }
  }

  async function refresh() {
    try {
      const s = await fetchRunnerStatus()
      setStatus(s)
      if (!s.runner.running) reportRunnerError(s.runner.lastError)
      reportPerLectureErrors(s)
    } catch {
      // SSE will fire again on the next backend transition; nothing to do.
    }
  }

  useEffect(() => {
    refresh()
    const es = new EventSource(`${databaseUrl}/events`)
    const onNotify = () => { refresh() }
    es.addEventListener('notify', onNotify)
    return () => {
      es.removeEventListener('notify', onNotify)
      es.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function trigger() {
    try {
      const s = await runAll()
      if (s === 'empty_queue') {
        sendUpdateRef.current?.('info', 'Nothing to run - All pipelines complete')
        return
      }
      setStatus(s)
    } catch (err) {
      sendUpdateRef.current?.('error', `Runner failed: ${err}`)
    }
  }

  function isInFlight(course: string, lecture: string, kind: Kind): boolean {
    const key = inFlightKey(course, lecture, kind)
    return status?.inFlight.some(e => inFlightKey(e.course, e.lecture, e.kind) === key) ?? false
  }

  function getInFlight(course: string, lecture: string, kind: Kind): InFlightEntry | null {
    const key = inFlightKey(course, lecture, kind)
    return status?.inFlight.find(e => inFlightKey(e.course, e.lecture, e.kind) === key) ?? null
  }

  return (
    <RunnerStatusContext.Provider value={{ status, trigger, isInFlight, getInFlight }}>
      {children}
    </RunnerStatusContext.Provider>
  )
}

export function useRunnerStatus() {
  return useContext(RunnerStatusContext)
}
