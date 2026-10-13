import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { AuthStatus } from '../services/autoDownloader'
import { fetchAuthStatus, subscribeAuth } from '../services/autoDownloader'
import { MoodleLockProvider } from './MoodleLockContext'

interface AuthStatusValue {
  // null means "unknown", never "disconnected": nothing has landed yet, or the one-shot read failed.
  status: AuthStatus | null
  // The first answer has landed: a pushed frame, or a one-shot read that finished or failed.
  settled: boolean
  refresh: () => Promise<void>
}

const AuthStatusContext = createContext<AuthStatusValue | null>(null)

// The university account for every chip and gate: the pushed state, plus `refresh`'s one-shot read for
// "no site configured", which the stream reads as idle. It never toasts; its `moodleBusy` feeds the lock.
export function AuthStatusProvider({ children }: { children: ReactNode }) {
  const [pushed, setPushed] = useState<AuthStatus | null>(null)
  const [probed, setProbed] = useState<AuthStatus | null>(null)
  const [probeDone, setProbeDone] = useState(false)

  useEffect(() => subscribeAuth(setPushed), [])

  const refresh = useCallback(async () => {
    try {
      setProbed(await fetchAuthStatus())
    } catch {
      // Connection errors are toasted centrally.
      setProbed(null)
    }
    setProbeDone(true)
  }, [])

  const status = useMemo(() => {
    if (!pushed) return probed
    return probed?.unconfigured && pushed.phase === 'idle'
      ? { ...pushed, unconfigured: true }
      : pushed
  }, [pushed, probed])

  const settled = pushed !== null || probeDone
  const value = useMemo(() => ({ status, settled, refresh }), [status, settled, refresh])
  return (
    <AuthStatusContext.Provider value={value}>
      <MoodleLockProvider frame={pushed}>{children}</MoodleLockProvider>
    </AuthStatusContext.Provider>
  )
}

export function useAuthStatus(): AuthStatusValue {
  const value = useContext(AuthStatusContext)
  if (!value) throw new Error('useAuthStatus must be used within an <AuthStatusProvider>')
  return value
}
