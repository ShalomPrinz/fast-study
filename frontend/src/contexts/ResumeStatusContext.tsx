import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ResumeStatus, InFlightEntry, Kind } from '../types'
import { resumeAll, fetchResumeStatus } from '../services/backend'
import { databaseUrl } from '../services/database'


interface ResumeStatusValue {
  status: ResumeStatus | null
  trigger: () => Promise<void>
  isInFlight: (course: string, lecture: string, kind: Kind) => boolean
  getInFlight: (course: string, lecture: string, kind: Kind) => InFlightEntry | null
}

const ResumeStatusContext = createContext<ResumeStatusValue>({
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

function inFlightKey(course: string, lecture: string, kind: Kind) {
  return `${course}||${lecture}||${kind}`
}

export function ResumeStatusProvider({ sendUpdate, children }: ProviderProps) {
  const [status, setStatus] = useState<ResumeStatus | null>(null)
  const lastReportedResumeCrashRef = useRef<string | null>(null)
  const lastReportedStepErrorsRef = useRef<Set<string>>(new Set())
  const sendUpdateRef = useRef(sendUpdate)
  useEffect(() => { sendUpdateRef.current = sendUpdate }, [sendUpdate])

  function reportResumeError(err: string | null) {
    if (err && err !== lastReportedResumeCrashRef.current) {
      lastReportedResumeCrashRef.current = err
      sendUpdateRef.current?.('error', err)
    }
  }

  function reportPerLectureErrors(s: ResumeStatus) {
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
      const s = await fetchResumeStatus()
      setStatus(s)
      if (!s.resume.running) reportResumeError(s.resume.lastError)
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
      const s = await resumeAll()
      if (s === 'empty_queue') {
        sendUpdateRef.current?.('info', 'Nothing to run - All pipelines complete')
        return
      }
      setStatus(s)
    } catch (err) {
      sendUpdateRef.current?.('error', `Resume failed: ${err}`)
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
    <ResumeStatusContext.Provider value={{ status, trigger, isInFlight, getInFlight }}>
      {children}
    </ResumeStatusContext.Provider>
  )
}

export function useResumeStatus() {
  return useContext(ResumeStatusContext)
}
