import { useCallback, useEffect, useRef, useState } from 'react'
import { runtimeBridge } from '@/services/runtime'
import type { UpdateState } from '@/services/runtime'

// The launcher's update phase: a snapshot on mount, then every push. No bridge, or an older launcher
// without `updates`, stays `null`, which hides the row.
export function useUpdateState(): UpdateState {
  const [state, setState] = useState<UpdateState>(null)
  useEffect(() => {
    const updates = runtimeBridge()?.updates
    if (!updates) return
    let live = true
    let pushed = false
    const unsubscribe = updates.subscribe((next) => {
      pushed = true
      setState(next)
    })
    // A push that lands before the snapshot answers is newer, so the snapshot never overwrites it.
    void updates.snapshot().then((first) => {
      if (live && !pushed) setState(first)
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [])
  return state
}

interface RestartFlow {
  restarting: boolean
  confirming: boolean
  request: () => void
  confirm: () => void
  cancel: () => void
}

// Restart now: asks first when `busy` (a pipeline or a download would be killed), then holds
// `restarting` until the app quits — dropped only when the launcher's refusal actually arrives.
export function useRestartToUpdate(busy: boolean): RestartFlow {
  const [restarting, setRestarting] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const started = useRef(false)

  const restart = useCallback(() => {
    const updates = runtimeBridge()?.updates
    setConfirming(false)
    if (!updates || started.current) return
    started.current = true
    setRestarting(true)
    const drop = () => {
      started.current = false
      setRestarting(false)
    }
    updates.restart().then((result) => {
      if (!result.ok) drop()
    }, drop)
  }, [])

  const request = useCallback(() => {
    if (busy) setConfirming(true)
    else restart()
  }, [busy, restart])

  const cancel = useCallback(() => setConfirming(false), [])

  return { restarting, confirming, request, confirm: restart, cancel }
}
