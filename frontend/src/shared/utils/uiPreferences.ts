// The two frontend-owned settings. They are the user's own UI preferences, so they live in
// `localStorage` — but their first-boot default comes from the settings store, so a fresh browser
// profile and a packaged install agree without a rebuild.
export type UiPreference = 'autoRunOnBoot' | 'runnerControlsVisible'

const STORAGE_KEYS: Record<UiPreference, string> = {
  autoRunOnBoot: 'fast-study:auto-run-on-boot',
  runnerControlsVisible: 'fast-study:runner-controls-visible',
}

// What a profile gets when neither it nor the store has an answer. Auto-run on means a fresh boot
// starts every pending pipeline by itself; the runner controls stay out of the way until asked for.
const SHIPPED: Record<UiPreference, boolean> = {
  autoRunOnBoot: true,
  runnerControlsVisible: false,
}

/** A stored user choice always wins; below it the store's first-boot default, then the shipped one. */
export function resolvePreference(
  stored: string | null,
  storeDefault: boolean | null,
  shipped: boolean,
): boolean {
  if (stored === 'true') return true
  if (stored === 'false') return false
  return storeDefault ?? shipped
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
  return resolvePreference(readStored(pref), null, SHIPPED[pref])
}

export function writePreference(pref: UiPreference, value: boolean): void {
  writeStored(pref, value)
  for (const listener of listeners) listener()
}

/** Pins the defaults a profile has never answered, from the settings store read at boot. Writing
 *  them once is what makes them *first-boot* defaults: a later store change never flips a profile. */
export function seedPreferences(store: Record<UiPreference, boolean | null>): void {
  for (const pref of Object.keys(SHIPPED) as UiPreference[]) {
    if (readStored(pref) !== null) continue
    writeStored(pref, resolvePreference(null, store[pref], SHIPPED[pref]))
  }
  for (const listener of listeners) listener()
}
