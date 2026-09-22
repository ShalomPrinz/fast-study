import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { t } from '@lingui/core/macro'
import type { RunnerStatus, InFlightEntry, Kind, RunError } from '@/types'
import { runAll, fetchRunnerStatus } from '@/services/backend'
import { isConnectionError } from '@/services/http'
import { inFlightKey } from '@/shared/utils/inFlightKey'
import { isGeminiQuota } from '@/shared/utils/runError'
import { failureId, type ServiceFailure } from '@/shared/i18n/serviceErrors'
import { serviceErrorNode } from '@/shared/components/ServiceError'
import { failureNode } from '@/shared/utils/failure'
import { useReportOnce } from '@/shared/hooks/useReportOnce'
import { useNotify } from '@/shared/hooks/useNotify'
import { useLatestRequest } from '@/shared/hooks/useLatestRequest'

interface RunnerStatusValue {
  status: RunnerStatus | null
  trigger: () => Promise<void>
  isInFlight: (course: string, lecture: string, kind: Kind) => boolean
  getInFlight: (course: string, lecture: string, kind: Kind) => InFlightEntry | null
  getError: (course: string, lecture: string, kind: Kind) => RunError | null
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
  sendUpdate?: (kind: UpdateKind, message: ReactNode) => void
  children: ReactNode
}

export function RunnerStatusProvider({ sendUpdate, children }: ProviderProps) {
  const [status, setStatus] = useState<RunnerStatus | null>(null)
  const sendUpdateRef = useRef(sendUpdate)
  useEffect(() => {
    sendUpdateRef.current = sendUpdate
  }, [sendUpdate])
  const {
    report: reportError,
    seed: seedError,
    prune: pruneErrors,
  } = useReportOnce<ReactNode>((node) => sendUpdateRef.current?.('error', node))

  const latest = useLatestRequest()
  // First applied status carries errors from before load: seed-and-suppress them, toast later ones.
  const primed = useRef(false)

  async function refresh() {
    try {
      const s = await latest(fetchRunnerStatus())
      if (!s) return
      setStatus(s)
      const validKeys = new Set(Object.keys(s.errors))
      validKeys.add('runner-crash')
      pruneErrors(validKeys)
      // Seeded before the first status is applied, so failures predating page load stay quiet.
      const announce = (key: string, failure: ServiceFailure) =>
        primed.current
          ? reportError(key, failureId(failure), serviceErrorNode(failure))
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
      primed.current = true
    } catch {
      // SSE will fire again on the next backend transition; nothing to do.
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

  return (
    <RunnerStatusContext.Provider value={{ status, trigger, isInFlight, getInFlight, getError }}>
      {children}
    </RunnerStatusContext.Provider>
  )
}

export function useRunnerStatus() {
  return useContext(RunnerStatusContext)
}
