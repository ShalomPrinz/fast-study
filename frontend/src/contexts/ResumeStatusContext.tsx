import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ResumeStatus } from '../types'
import { resumeAll, fetchResumeStatus } from '../services/backend'
import { databaseUrl } from '../services/database'

// Architecture: Backend fires a database `/notify` SSE ping at every meaningful
// state change in resume.py (step start, step done, rate-limit start, wake, error,
// run start/complete). We refetch once per ping; that's it.
//
// Exposed as a provider so Sidebar + MainView share a single EventSource and a
// single `lastReportedError` dedupe ref — see frontend/CLAUDE.md.

interface ResumeStatusValue {
  status: ResumeStatus | null
  trigger: () => Promise<void>
}

const ResumeStatusContext = createContext<ResumeStatusValue>({
  status: null,
  trigger: async () => {},
})

interface ProviderProps {
  onError?: (message: string) => void
  children: ReactNode
}

export function ResumeStatusProvider({ onError, children }: ProviderProps) {
  const [status, setStatus] = useState<ResumeStatus | null>(null)
  const lastReportedErrorRef = useRef<string | null>(null)
  const onErrorRef = useRef(onError)
  useEffect(() => { onErrorRef.current = onError }, [onError])

  function reportIfNew(err: string | null) {
    if (err && err !== lastReportedErrorRef.current) {
      lastReportedErrorRef.current = err
      onErrorRef.current?.(err)
    }
  }

  async function refresh() {
    try {
      const s = await fetchResumeStatus()
      setStatus(s)
      if (!s.running) reportIfNew(s.lastError)
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
      setStatus(s)
    } catch (err) {
      onErrorRef.current?.(`Resume failed: ${err}`)
    }
  }

  return (
    <ResumeStatusContext.Provider value={{ status, trigger }}>
      {children}
    </ResumeStatusContext.Provider>
  )
}

export function useResumeStatus() {
  return useContext(ResumeStatusContext)
}
