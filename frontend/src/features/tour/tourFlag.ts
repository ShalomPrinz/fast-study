const KEY = 'fast-study:tour-dismissed'

// A failed read means "not seen": an unreadable flag must never hide the onboarding.
export function isTourSeen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function markTourSeen(): void {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    // best effort: the tour shows again next launch
  }
}

export const TOUR_STORAGE_KEY = KEY
