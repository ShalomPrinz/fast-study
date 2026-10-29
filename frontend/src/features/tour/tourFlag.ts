const KEY = 'fast-study:tour-dismissed'

// A failed read means "show the tour": an unreadable flag must never hide the onboarding.
export function isTourDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function dismissTour(): void {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    // best effort: the tour shows again next launch
  }
}

export const TOUR_STORAGE_KEY = KEY
