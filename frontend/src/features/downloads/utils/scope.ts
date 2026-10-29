export type Scope = 'new' | 'all'

export const SCOPE_KEY = 'fastStudyDownloadsScope'

// New unless the user last chose All; anything unreadable falls back to New.
export function storedScope(raw: string | null): Scope {
  return raw === 'all' ? 'all' : 'new'
}

export function readScope(): Scope {
  try {
    return storedScope(localStorage.getItem(SCOPE_KEY))
  } catch {
    return 'new'
  }
}

export function writeScope(scope: Scope): void {
  try {
    localStorage.setItem(SCOPE_KEY, scope)
  } catch {
    // Storage blocked: the choice lasts this visit only.
  }
}

// The media cards' storage key, shared with the All view's `ModeToggle`.
export const MEDIA_KEY = 'fastStudyDownloadsMedia'
