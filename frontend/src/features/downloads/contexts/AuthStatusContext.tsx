import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { AuthStatus } from '../services/autoDownloader'
import { fetchAuthStatus, subscribeAuth } from '../services/autoDownloader'

interface AuthStatusValue {
  // null means "unknown", never "disconnected": nothing has landed yet, or the one-shot read failed.
  status: AuthStatus | null
  refresh: () => Promise<void>
}

const AuthStatusContext = createContext<AuthStatusValue | null>(null)

// The university account, one answer for every chip and gate: the service's pushed state, with `refresh`'s
// one-shot read kept for what the stream cannot say — no site configured reads as idle there. The stream
// never toasts, so a route with no account control never reports the auto-downloader as down.
export function AuthStatusProvider({ children }: { children: ReactNode }) {
  const [pushed, setPushed] = useState<AuthStatus | null>(null)
  const [probed, setProbed] = useState<AuthStatus | null>(null)

  useEffect(() => subscribeAuth(setPushed), [])

  const refresh = useCallback(async () => {
    try {
      setProbed(await fetchAuthStatus())
    } catch {
      // Connection errors are toasted centrally.
      setProbed(null)
    }
  }, [])

  const status = useMemo(() => {
    if (!pushed) return probed
    return probed?.unconfigured && pushed.phase === 'idle'
      ? { ...pushed, unconfigured: true }
      : pushed
  }, [pushed, probed])

  const value = useMemo(() => ({ status, refresh }), [status, refresh])
  return <AuthStatusContext.Provider value={value}>{children}</AuthStatusContext.Provider>
}

export function useAuthStatus(): AuthStatusValue {
  const value = useContext(AuthStatusContext)
  if (!value) throw new Error('useAuthStatus must be used within an <AuthStatusProvider>')
  return value
}
