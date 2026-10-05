export type PickFolder = (defaultPath?: string) => Promise<string | null>

/** Opens the native folder dialog at most once at a time — a second click while one is up is
 *  dropped — and hands on only a chosen path, so a cancel leaves the field as it was. */
export function createFolderPick(pick: PickFolder) {
  let pending = false
  return async (current: string, onPicked: (path: string) => void): Promise<void> => {
    if (pending) return
    pending = true
    try {
      const chosen = await pick(current || undefined)
      if (chosen !== null) onPicked(chosen)
    } finally {
      pending = false
    }
  }
}
