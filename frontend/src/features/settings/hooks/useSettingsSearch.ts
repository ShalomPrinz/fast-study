import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { paint, scan, scrollToMatch, type DomMatch } from '../utils/searchDom'
import { stepMatch } from '../utils/settingsSearch'

// Highlights a query across the text under `rootRef`, keeps its matches current as that DOM changes,
// and scrolls to the one in focus. Highlight only: nothing hides.
export function useSettingsSearch(rootRef: RefObject<HTMLElement | null>) {
  const [query, setQuery] = useState('')
  const [current, setCurrent] = useState(0)
  const [count, setCount] = useState(0)
  const matches = useRef<DomMatch[]>([])
  const focus = useRef(0)

  const refresh = useCallback(
    (q: string, at: number, scroll: boolean) => {
      const root = rootRef.current
      matches.current = root && q.trim() ? scan(root, q) : []
      const total = matches.current.length
      focus.current = total ? Math.min(at, total - 1) : 0
      setCount(total)
      setCurrent(focus.current)
      paint(root, matches.current, focus.current)
      if (scroll) scrollToMatch(matches.current[focus.current])
    },
    [rootRef],
  )

  // A new query starts over at the first match.
  useEffect(() => refresh(query, 0, true), [query, refresh])

  // A toggle revealing a field or a probe result landing changes the text under a standing query.
  useEffect(() => {
    const root = rootRef.current
    if (!query.trim() || !root) return
    let frame = 0
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => refresh(query, focus.current, false))
    })
    observer.observe(root, { childList: true, subtree: true, characterData: true })
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [query, rootRef, refresh])

  useEffect(() => () => paint(null, [], 0), [])

  const step = useCallback(
    (direction: 1 | -1) => {
      const next = stepMatch(focus.current, matches.current.length, direction)
      focus.current = next
      setCurrent(next)
      paint(rootRef.current, matches.current, next)
      scrollToMatch(matches.current[next])
    },
    [rootRef],
  )

  return { query, setQuery, current, count, step }
}
