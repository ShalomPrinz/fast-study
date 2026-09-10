import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { AuthStatus } from '../services/autoDownloader'
import { fetchAuthStatus } from '../services/autoDownloader'

interface AuthStatusValue {
  // null means "unknown", never "disconnected": no probe has landed yet, or the last one failed.
  status: AuthStatus | null
  refresh: () => Promise<void>
}

const AuthStatusContext = createContext<AuthStatusValue | null>(null)

// The BIU account probe, held above the page so the header chip and every course row read one answer.
// Nothing probes on mount: `AccountStatus` asks wherever it renders, so a route carrying no account
// control leaves the auto-downloader alone rather than toasting it as down.
export function AuthStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null)

  const refresh = useCallback(async () => {
    try {
      setStatus(await fetchAuthStatus())
    } catch {
      // Connection errors are toasted centrally.
      setStatus(null)
    }
  }, [])

  const value = useMemo(() => ({ status, refresh }), [status, refresh])
  return <AuthStatusContext.Provider value={value}>{children}</AuthStatusContext.Provider>
}

export function useAuthStatus(): AuthStatusValue {
  const value = useContext(AuthStatusContext)
  if (!value) throw new Error('useAuthStatus must be used within an <AuthStatusProvider>')
  return value
}
