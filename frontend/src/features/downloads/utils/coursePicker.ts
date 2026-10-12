import type { ServiceFailure } from '@/shared/i18n/serviceErrors'
import { failureOf } from '@/shared/utils/failure'
import type { AuthStatus, EnrolledCourse } from '../services/autoDownloader'
import { isBlockedError, isReconnectError, isUnsupportedError } from '../services/autoDownloader'

// The picker's course list: still fetching, the account's courses, or none to offer (the site's
// list is closed to the Moodle app, or the fetch failed).
export type PickerList = 'loading' | 'unavailable' | EnrolledCourse[]

// What the picker shows. Anything but a list it can offer opens straight on the paste input.
export function pickerView(
  status: AuthStatus | null,
  list: PickerList,
  pasting: boolean,
): 'loading' | 'list' | 'paste' {
  if (pasting || status?.connected === false) return 'paste'
  if (list === 'loading') return 'loading'
  return list === 'unavailable' || list.length === 0 ? 'paste' : 'list'
}

// Current courses first; past ones (hidden or ended) behind "Show past courses". Order is kept.
export function splitCourses(courses: EnrolledCourse[]): {
  current: EnrolledCourse[]
  past: EnrolledCourse[]
} {
  return {
    current: courses.filter((c) => !c.past),
    past: courses.filter((c) => c.past),
  }
}

// A URL is checked before saving unless it is empty (clearing) or came from Moodle's own list.
export function needsCheck(url: string, fromMoodle: boolean): boolean {
  return !fromMoodle && url.trim() !== ''
}

export interface AddFormDraft {
  name: string
  url: string
  urlFixed: boolean
}

// The add form a picker answer opens: a picked course's name to edit, and any URL from the picker (Moodle's
// own, or a paste it checked or saved anyway) fixed; an empty paste leaves the URL free to type.
export function addFormDraft(name: string, url: string): AddFormDraft {
  return { name, url, urlFixed: url !== '' }
}

// Why a pasted URL's check failed, as a failure the catalog can say. The typed refusals carry their
// meaning in the error's class, so they are given their protocol code back; a busy lock is a coded one.
export function checkFailure(err: unknown): ServiceFailure {
  if (isReconnectError(err)) return { message: err.message, code: 'moodle_reconnect_required' }
  if (isBlockedError(err)) {
    return {
      message: err.message,
      code: 'site_blocked',
      params: { challengeWindow: err.challengeWindow },
    }
  }
  if (isUnsupportedError(err)) return err
  return failureOf(err)
}
