import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { RunnerStatus, InFlightEntry, Kind } from '../types'
import { runAll, fetchRunnerStatus } from '../services/backend'
import { databaseUrl } from '../services/database'
import { inFlightKey } from '../utils/inFlightKey'
import { useReportOnce } from '../hooks/useReportOnce'


interface RunnerStatusValue {
  status: RunnerStatus | null
  trigger: () => Promise<void>
  isInFlight: (course: string, lecture: string, kind: Kind) => boolean
  getInFlight: (course: string, lecture: string, kind: Kind) => InFlightEntry | null
  getError: (course: string, lecture: string, kind: Kind) => string | null
}

const RunnerStatusContext = createContext<RunnerStatusValue>({
  status: null,
  trigger: async () => {},
  isInFlight: () => false,
  getInFlight: () => null,
  getError: () => null,
})

type UpdateKind = 'info' | 'error'

interface ProviderProps {
  sendUpdate?: (kind: UpdateKind, message: string) => void
  children: ReactNode
}

export function RunnerStatusProvider({ sendUpdate, children }: ProviderProps) {
  const [status, setStatus] = useState<RunnerStatus | null>(null)
  const sendUpdateRef = useRef(sendUpdate)
  useEffect(() => { sendUpdateRef.current = sendUpdate }, [sendUpdate])
  const { report: reportError, prune: pruneErrors } = useReportOnce(
    (msg) => sendUpdateRef.current?.('error', msg),
  )

  async function refresh() {
    try {
      const s = await fetchRunnerStatus()
      setStatus(s)
      const validKeys = new Set(Object.keys(s.errors))
      validKeys.add('runner-crash')
      pruneErrors(validKeys)
      if (!s.runner.running && s.runner.lastError) {
        reportError('runner-crash', s.runner.lastError)
      }
      for (const [key, message] of Object.entries(s.errors)) {
        reportError(key, message)
      }
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

  function getError(course: string, lecture: string, kind: Kind): string | null {
    return status?.errors[inFlightKey(course, lecture, kind)] ?? null
  }

  return (
    <RunnerStatusContext.Provider value={{ status, trigger, isInFlight, getInFlight, getError }}>
      {children}
    </RunnerStatusContext.Provider>
  )
}

export function useRunnerStatus() {
  return useContext(RunnerStatusContext)
}
