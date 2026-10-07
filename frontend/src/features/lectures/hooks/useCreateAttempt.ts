import { useRef, useState } from 'react'
import { isConnectionError } from '@/services/http'

export interface CreateAttempt {
  pending: boolean
  // The last refused create, shown in place of the toast; a connection error is already toasted by the client.
  error: unknown
  // Runs one create and resolves whether it succeeded; a second call while one runs is ignored.
  run: (create: () => Promise<unknown>) => Promise<boolean>
  reset: () => void
}

// The in-flight and failed state of a create whose input stays open until it succeeds.
export function useCreateAttempt(): CreateAttempt {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const busy = useRef(false)
  // Bumped by reset, so a create finishing after the input was cancelled doesn't leave its error on a later one.
  const generation = useRef(0)

  async function run(create: () => Promise<unknown>) {
    if (busy.current) return false
    busy.current = true
    const mine = generation.current
    setPending(true)
    setError(null)
    try {
      await create()
      return true
    } catch (e) {
      if (mine === generation.current && !isConnectionError(e)) setError(e)
      return false
    } finally {
      busy.current = false
      if (mine === generation.current) setPending(false)
    }
  }

  function reset() {
    generation.current++
    busy.current = false
    setPending(false)
    setError(null)
  }

  return { pending, error, run, reset }
}
