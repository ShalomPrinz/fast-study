import type { SavedSettings } from '@/services/settings'

// How close to the end of the policy counts as read: sub-pixel scroll positions never reach it exactly.
const BOTTOM_SLACK_PX = 2

/** Whether the policy's scroll box has been read to its end — at once when it never scrolls. */
export function readToEnd(box: { scrollTop: number; clientHeight: number; scrollHeight: number }) {
  return box.scrollTop + box.clientHeight >= box.scrollHeight - BOTTOM_SLACK_PX
}

/** The form fields a modal answer sets: confirm turns reports on, decline off; both count as read. */
export function privacyAnswer(confirmed: boolean) {
  return { errorReports: confirmed, privacyConfirmed: true }
}

/** The wall's save asks the policy first while it is unanswered and the switch exists at all. */
export function wallMustAskPrivacy(privacyConfirmed: boolean, canSetErrorReports: boolean) {
  return canSetErrorReports && !privacyConfirmed
}

/** After a Settings save: which switch state still waits on a restart somewhere, or null. */
export function restartNotice(saved: SavedSettings): 'on' | 'off' | null {
  if (!saved.errorReportsRestartNeeded) return null
  return saved.errorReports === true ? 'on' : 'off'
}
