import { useState, useEffect, useCallback } from 'react'

// String-keyed set for expand/collapse UI state (e.g. which courses are open).
// `validKeys` is the current universe of legal keys — when an item disappears
// from it (course renamed/deleted), the set auto-prunes so stale keys can't
// linger and resurrect a phantom "expanded" state if the name is reused.
export function useToggleSet(validKeys: readonly string[]) {
  const [set, setSet] = useState<Set<string>>(new Set())
  const dep = validKeys.join('\x00')

  useEffect(() => {
    const valid = new Set(validKeys)
    setSet((prev) => {
      const next = new Set([...prev].filter((k) => valid.has(k)))
      return next.size === prev.size ? prev : next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep])

  const has = useCallback((k: string) => set.has(k), [set])

  const toggle = useCallback((k: string) => {
    setSet((prev) => {
      const next = new Set(prev)
      next.has(k) ? next.delete(k) : next.add(k)
      return next
    })
  }, [])

  const add = useCallback((k: string) => {
    setSet((prev) => (prev.has(k) ? prev : new Set([...prev, k])))
  }, [])

  return { has, toggle, add }
}
