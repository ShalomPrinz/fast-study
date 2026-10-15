import { useEffect, useSyncExternalStore } from 'react'

// How many mounted components need the UI locale to stay put; a module store, so the sidebar needs no provider.
let holds = 0
const listeners = new Set<() => void>()

function change(delta: number) {
  holds += delta
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Holds the locale while mounted: the course picker, whose one `/courses` call is named in it.
export function useLocaleHold(): void {
  useEffect(() => {
    change(1)
    return () => change(-1)
  }, [])
}

// True while anything holds the locale; the language switcher disables itself.
export function useLocaleHeld(): boolean {
  return useSyncExternalStore(subscribe, () => holds > 0)
}
