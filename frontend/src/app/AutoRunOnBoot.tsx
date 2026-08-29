import { useEffect, useRef } from 'react'
import { useRunnerStatus } from '@/shared/contexts/RunnerStatusContext'
import { readPreference } from '@/shared/utils/uiPreferences'

// Fires the runner once when the app comes up, if the user's preference says so. Renders nothing:
// it is a boot action, not a control. The ref is what keeps StrictMode's second effect from
// triggering a second sweep.
export default function AutoRunOnBoot() {
  const { trigger } = useRunnerStatus()
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current || !readPreference('autoRunOnBoot')) return
    fired.current = true
    void trigger()
  }, [])

  return null
}
