import { useEffect, useRef, useState } from 'react'
import type { ResumeStatus } from '../types'
import { resumeAll, fetchResumeStatus } from '../services/backend'

const POLL_INTERVAL_MS = 10_000

export function useResumeStatus(onError?: (message: string) => void) {
  const [status, setStatus] = useState<ResumeStatus | null>(null)
  const pollRef = useRef<number | null>(null)
  const lastReportedErrorRef = useRef<string | null>(null)
  const onErrorRef = useRef(onError)
  useEffect(() => { onErrorRef.current = onError }, [onError])

  function reportIfNew(err: string | null) {
    if (err && err !== lastReportedErrorRef.current) {
      lastReportedErrorRef.current = err
      onErrorRef.current?.(err)
    }
  }

  function stopPolling() {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  function startPolling() {
    if (pollRef.current !== null) return
    pollRef.current = window.setInterval(async () => {
      try {
        const s = await fetchResumeStatus()
        setStatus(s)
        if (!s.running) {
          stopPolling()
          reportIfNew(s.lastError)
        }
      } catch {
        // transient — keep polling
      }
    }, POLL_INTERVAL_MS)
  }

  useEffect(() => () => stopPolling(), [])

  // On mount, check if a resume is already in flight (e.g. cron-triggered).
  useEffect(() => {
    fetchResumeStatus().then((s) => {
      setStatus(s)
      if (s.running) startPolling()
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function trigger() {
    try {
      const s = await resumeAll()
      setStatus(s)
      if (s.running) startPolling()
    } catch (err) {
      onErrorRef.current?.(`Resume failed: ${err}`)
    }
  }

  return { status, trigger }
}
