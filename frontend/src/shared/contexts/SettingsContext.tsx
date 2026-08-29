import { createContext, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import type { Settings } from '@/services/settings'

interface SettingsValue {
  settings: Settings | null
  setSettings: (next: Settings) => void
}

const SettingsContext = createContext<SettingsValue | null>(null)

// The store's answer, held where the whole app can read it. It has no fetch of its own: the boot
// read in InitGate and the save in SettingsView push here, so a change reaches every screen at once.
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null)

  return (
    <SettingsContext.Provider value={{ settings, setSettings }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettingsContext(): SettingsValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettingsContext must be used inside <SettingsProvider>')
  return ctx
}

/** Whether Drive is part of the pipeline. Nothing stored means off — the same default the backend's
 *  `settings.drive_enabled()` gives a missing DRIVE_ENABLED, so both ends agree on a fresh install. */
export function useDriveEnabled(): boolean {
  return useSettingsContext().settings?.driveEnabled ?? false
}
