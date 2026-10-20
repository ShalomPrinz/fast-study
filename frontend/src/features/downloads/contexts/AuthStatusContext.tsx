import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { AuthStatus } from '../services/autoDownloader'
import { fetchAuthStatus, subscribeAuth } from '../services/autoDownloader'
import { MoodleLockProvider } from './MoodleLockContext'
import { createSiteCaptchaSolves } from '../utils/captchaBanner'
import { siteSolveToasts } from '../utils/accountView'

interface AuthStatusValue {
  // null means "unknown", never "disconnected": nothing has landed yet, or the one-shot read failed.
  status: AuthStatus | null
  // The first answer has landed: a pushed frame, or a one-shot read that finished or failed.
  settled: boolean
  refresh: () => Promise<void>
}

const AuthStatusContext = createContext<AuthStatusValue | null>(null)
// Registers a mounted account panel for its lifetime; returns the unregister.
const AccountPanelContext = createContext<(() => () => void) | null>(null)

// The account state every chip and gate reads: the pushed frames plus `refresh`'s one-shot read for no site.
// `onSiteCaptchaSolved` fires per solve this tab saw, unless a mounted account panel says so (`siteSolveToasts`).
export function AuthStatusProvider({
  children,
  onSiteCaptchaSolved,
}: {
  children: ReactNode
  onSiteCaptchaSolved?: () => void
}) {
  const [pushed, setPushed] = useState<AuthStatus | null>(null)
  const [probed, setProbed] = useState<AuthStatus | null>(null)
  const [probeDone, setProbeDone] = useState(false)
  const onSolved = useRef(onSiteCaptchaSolved)
  onSolved.current = onSiteCaptchaSolved
  const accountPanels = useRef(0)
  const registerAccountPanel = useCallback(() => {
    accountPanels.current += 1
    return () => {
      accountPanels.current -= 1
    }
  }, [])

  useEffect(() => {
    const solves = createSiteCaptchaSolves()
    return subscribeAuth((frame) => {
      if (solves.frame(frame) && siteSolveToasts(frame, accountPanels.current > 0))
        onSolved.current?.()
      setPushed(frame)
    }, solves.reseed)
  }, [])

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
      <AccountPanelContext.Provider value={registerAccountPanel}>
        <MoodleLockProvider frame={pushed}>{children}</MoodleLockProvider>
      </AccountPanelContext.Provider>
    </AuthStatusContext.Provider>
  )
}

export function useAuthStatus(): AuthStatusValue {
  const value = useContext(AuthStatusContext)
  if (!value) throw new Error('useAuthStatus must be used within an <AuthStatusProvider>')
  return value
}

// Marks an account panel as on screen while the caller is mounted, so its own solve line replaces the toast.
export function useAccountPanelShown(): void {
  const register = useContext(AccountPanelContext)
  if (!register) throw new Error('useAccountPanelShown must be used within an <AuthStatusProvider>')
  useEffect(() => register(), [register])
}
