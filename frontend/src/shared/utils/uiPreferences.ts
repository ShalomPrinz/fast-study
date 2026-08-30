// The frontend-owned settings. They are the user's own UI preferences, so they live in
// `localStorage` and never reach the settings store.
export type UiPreference = 'runnerControlsVisible'

const STORAGE_KEYS: Record<UiPreference, string> = {
  runnerControlsVisible: 'fast-study:runner-controls-visible',
}

// What a profile gets before it answers: the runner controls stay out of the way until asked for.
const SHIPPED: Record<UiPreference, boolean> = {
  runnerControlsVisible: false,
}

/** A stored user choice always wins; anything else is the shipped default. */
export function resolvePreference(stored: string | null, shipped: boolean): boolean {
  if (stored === 'true') return true
  if (stored === 'false') return false
  return shipped
}

// Storage access throws with cookies blocked or in some private modes; a lost preference must never
// cost a render, so both directions degrade to "no stored choice".
function readStored(pref: UiPreference): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS[pref])
  } catch {
    return null
  }
}

function writeStored(pref: UiPreference, value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEYS[pref], String(value))
  } catch {
    // best effort
  }
}

const listeners = new Set<() => void>()

/** Notified on every write, so a toggle on the settings route reaches the sidebar without a reload. */
export function subscribePreferences(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

export function readPreference(pref: UiPreference): boolean {
  return resolvePreference(readStored(pref), SHIPPED[pref])
}

export function writePreference(pref: UiPreference, value: boolean): void {
  writeStored(pref, value)
  for (const listener of listeners) listener()
}
