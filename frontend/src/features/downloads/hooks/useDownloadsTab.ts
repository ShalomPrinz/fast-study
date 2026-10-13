import { useState } from 'react'
import { useAuthStatus } from '@/features/downloads/contexts/AuthStatusContext'
import { defaultTab, TAB_STORAGE_KEY } from '@/features/downloads/utils/downloadsTab'
import type { DownloadsTab } from '@/features/downloads/utils/downloadsTab'

// The account-based default, fixed for the app session the first time the account read settles, so a
// later sign-out or a return to the page never moves it.
let sessionDefault: DownloadsTab | null = null

// Access throws with site data blocked, which reads as nothing stored.
function readStored(): string | null {
  try {
    return localStorage.getItem(TAB_STORAGE_KEY)
  } catch {
    return null
  }
}

// The open Downloads tab, or null while nothing is stored and the account read has not settled.
// Only a click is stored.
export function useDownloadsTab(): [DownloadsTab | null, (tab: DownloadsTab) => void] {
  const { status, settled } = useAuthStatus()
  const [chosen, setChosen] = useState(() => defaultTab(readStored(), null))
  if (sessionDefault === null)
    sessionDefault = defaultTab(null, settled ? !!status?.connected : null)

  function select(next: DownloadsTab) {
    setChosen(next)
    try {
      localStorage.setItem(TAB_STORAGE_KEY, next)
    } catch {
      // Not remembered this time; the switch itself still works.
    }
  }

  return [chosen ?? sessionDefault, select]
}
