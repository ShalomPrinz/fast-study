import { useSyncExternalStore } from 'react'
import {
  readPreference,
  subscribePreferences,
  type UiPreference,
} from '@/shared/utils/uiPreferences'

// Reads one UI preference and re-renders on every write, so toggling it on the settings route hides
// or shows the sidebar's runner controls at once rather than on the next reload.
export function usePreference(pref: UiPreference): boolean {
  return useSyncExternalStore(subscribePreferences, () => readPreference(pref))
}
