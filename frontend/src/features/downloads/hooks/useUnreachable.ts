import { useEffect, useState } from 'react'
import { UNREACHABLE_AFTER_MS } from '@/features/downloads/utils/accountView'

// True once `checking` has held for 10 s; any turn of `checking` to false resets it, so a later loss restarts the wait.
export function useUnreachable(checking: boolean): boolean {
  const [unreachable, setUnreachable] = useState(false)
  useEffect(() => {
    if (!checking) {
      setUnreachable(false)
      return
    }
    const id = setTimeout(() => setUnreachable(true), UNREACHABLE_AFTER_MS)
    return () => clearTimeout(id)
  }, [checking])
  return checking && unreachable
}
