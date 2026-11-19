export type SaveState = 'saving' | 'saved' | 'idle'

/** What the header status shows: a save in flight wins over a landed one; a failure leaves neither. */
export function saveState(saving: boolean, savedTick: number): SaveState {
  if (saving) return 'saving'
  return savedTick > 0 ? 'saved' : 'idle'
}
