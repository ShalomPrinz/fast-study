import { useEffect, useSyncExternalStore } from 'react'

// How many mounted pickers are waiting on their course list; a module store, so the page header needs no provider.
let waiting = 0
const listeners = new Set<() => void>()

function change(delta: number) {
  waiting += delta
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Reports whether this picker is waiting on its course list.
export function useReportPickerLoading(loading: boolean): void {
  useEffect(() => {
    if (!loading) return
    change(1)
    return () => change(-1)
  }, [loading])
}

// True while any picker waits on its course list; the page header runs its loadbar.
export function usePickerLoading(): boolean {
  return useSyncExternalStore(subscribe, () => waiting > 0)
}
