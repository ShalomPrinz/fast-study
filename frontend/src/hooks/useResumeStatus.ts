import { useEffect, useRef, useState } from 'react'
import type { ResumeStatus } from '../types'
import { resumeAll, fetchResumeStatus } from '../services/backend'
import { databaseUrl } from '../services/database'

// Architecture: Backend fires a database `/notify` SSE ping at every meaningful
// state change in resume.py (step start, step done, rate-limit start, wake, error,
// run start/complete). We refetch once per ping; that's it.
export function useResumeStatus(onError?: (message: string) => void) {
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

  return { status, trigger }
}
