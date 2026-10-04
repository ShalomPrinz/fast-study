import { useCallback, useEffect, useState } from 'react'
import { fetchBrowserPrereq } from '@/services/settings'

export type BrowserPrereqState =
  | { kind: 'checking' }
  | { kind: 'available'; browser: string; channel: string | null }
  | { kind: 'missing'; detail: string }
  // The service was unreachable, which is an unknown answer and never "no browser" — the same rule
  // the API key probe follows for an unreachable provider.
  | { kind: 'unknown' }

// The browser check, lifted out of its field so the init wall can decide whether to show it at all.
// `missingSeen` stays true once any check said missing, so a re-check never hides the field mid-answer.
export function useBrowserPrereq() {
  const [state, setState] = useState<BrowserPrereqState>({ kind: 'checking' })
  const [missingSeen, setMissingSeen] = useState(false)

  const check = useCallback(async () => {
    setState({ kind: 'checking' })
    try {
      const prereq = await fetchBrowserPrereq()
      if (prereq.available && prereq.browser) {
        setState({ kind: 'available', browser: prereq.browser, channel: prereq.channel })
      } else {
        setState({ kind: 'missing', detail: prereq.detail })
        setMissingSeen(true)
      }
    } catch {
      // A downed service is already toasted centrally by the http client; the field only stops
      // claiming anything about this machine.
      setState({ kind: 'unknown' })
    }
  }, [])

  useEffect(() => {
    void check()
  }, [check])

  return { state, check, missingSeen }
}
