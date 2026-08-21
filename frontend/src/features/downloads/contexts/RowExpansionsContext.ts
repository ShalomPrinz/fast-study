import { useCallback, useSyncExternalStore } from 'react'
import type { Item } from '../services/autoDownloader'

// One playlist row's expand state: whether it is open, its fetched children (cached, so
// collapse/re-expand never refetches), and the in-flight/error state of that fetch.
export interface ExpandState {
  expanded: boolean
  children: Item[] | null
  expanding: boolean
  error: string | null
}

// Shared identity for "this ref was never expanded". `useSyncExternalStore` compares snapshots by
// reference, so a fresh object per read would re-render forever.
export const IDLE_EXPAND: ExpandState = Object.freeze({
  expanded: false,
  children: null,
  expanding: false,
  error: null,
})

// Module-level store: the page's expansions, with per-ref subscriptions on top, so expanding one
// playlist re-renders only that row. It outlives every component, so the session's `clear()` calls
// `clearExpansions()` on course switch and close to bound its lifetime.
let expansions: Record<string, ExpandState> = {}
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function publish(next: Record<string, ExpandState>) {
  expansions = next
  for (const listener of listeners) listener()
}

// Structural sharing is load-bearing: replacing only `[ref]` leaves every sibling entry's identity
// intact, which is what lets the other rows' `getSnapshot` return an unchanged value and bail out.
export function patchExpansion(ref: string, next: Partial<ExpandState>) {
  publish({ ...expansions, [ref]: { ...(expansions[ref] ?? IDLE_EXPAND), ...next } })
}

export function clearExpansions() {
  publish({})
}

// Reads the store outside React, for callbacks that must not close over a snapshot.
export function expansionOf(ref: string): ExpandState {
  return expansions[ref] ?? IDLE_EXPAND
}

// One row's expand state, by its discovery `ref` — a row that was never expanded reads the shared
// `IDLE_EXPAND` and so never re-renders on another row's expand.
export function useRowExpansion(ref: string): ExpandState {
  return useSyncExternalStore(
    subscribe,
    useCallback(() => expansionOf(ref), [ref]),
  )
}

// The whole map, for `SectionGroup` — the bulk queue needs every playlist's resolved children and
// "Download all" needs to know they are all expanded, so this is correct scope, not a leak.
export function useAllExpansions(): Record<string, ExpandState> {
  return useSyncExternalStore(subscribe, () => expansions)
}
