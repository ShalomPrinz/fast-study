import { useState } from 'react'
import { useAuthStatus } from '@/features/downloads/contexts/AuthStatusContext'
import { defaultTab, TAB_STORAGE_KEY } from '@/features/downloads/utils/downloadsTab'
import type { DownloadsTab } from '@/features/downloads/utils/downloadsTab'

// Access throws with site data blocked, which reads as nothing stored.
function readStored(): string | null {
  try {
    return localStorage.getItem(TAB_STORAGE_KEY)
  } catch {
    return null
  }
}

// The open Downloads tab. Only a click is stored; the account-based default is fixed the first time
// the account is known, so a later sign-out never moves the page, and University stands in until then.
export function useDownloadsTab(): [DownloadsTab, (tab: DownloadsTab) => void] {
  const connected = useAuthStatus().status?.connected
  const [tab, setTab] = useState(() => defaultTab(readStored(), connected))
  if (tab === null && connected !== undefined) setTab(defaultTab(null, connected))

  function select(next: DownloadsTab) {
    setTab(next)
    try {
      localStorage.setItem(TAB_STORAGE_KEY, next)
    } catch {
      // Not remembered this time; the switch itself still works.
    }
  }

  return [tab ?? 'university', select]
}
