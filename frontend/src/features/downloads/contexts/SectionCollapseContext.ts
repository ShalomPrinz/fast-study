import { useCallback, useSyncExternalStore } from 'react'

// Module store of collapsed sections, keyed by `SectionGroup`'s `collapseKey`. Absent means open;
// it outlives every component, so the session's `clear()` resets it.
let collapsed: Record<string, true> = {}
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function publish(next: Record<string, true>) {
  collapsed = next
  for (const listener of listeners) listener()
}

export function toggleSection(key: string) {
  if (collapsed[key]) expandSection(key)
  else publish({ ...collapsed, [key]: true })
}

export function expandSection(key: string) {
  if (!collapsed[key]) return
  const next = { ...collapsed }
  delete next[key]
  publish(next)
}

export function clearSectionCollapse() {
  publish({})
}

export function isSectionOpen(key: string): boolean {
  return !collapsed[key]
}

// One section's open state — a boolean snapshot, so a section re-renders only on its own toggle.
export function useSectionOpen(key: string): boolean {
  return useSyncExternalStore(
    subscribe,
    useCallback(() => isSectionOpen(key), [key]),
  )
}
