import { describe, it, expect } from 'vitest'
import { MoodleBusyError, RequestError } from '@/services/http'
import {
  BlockedError,
  ReconnectError,
  UnsupportedError,
  type AuthStatus,
  type EnrolledCourse,
} from '../services/autoDownloader'
import { addFormDraft, checkFailure, needsCheck, pickerView, splitCourses } from './coursePicker'

const course = (id: number, past = false): EnrolledCourse => ({
  id,
  name: `Course ${id}`,
  url: `https://moodle.example.ac.il/course/view.php?id=${id}`,
  past,
})
const connected: AuthStatus = { connected: true, expired: false }
const disconnected: AuthStatus = { connected: false, expired: false }

describe('pickerView', () => {
  it('shows the list once courses arrive, loading until then', () => {
    expect(pickerView(connected, 'loading', false)).toBe('loading')
    expect(pickerView(connected, [course(101)], false)).toBe('list')
    expect(pickerView(null, [course(101)], false)).toBe('list')
  })

  it('opens straight on the paste input with no list to offer', () => {
    expect(pickerView(connected, 'unavailable', false)).toBe('paste')
    expect(pickerView(connected, [], false)).toBe('paste')
  })

  it('opens on the paste input when not connected, whatever the list', () => {
    expect(pickerView(disconnected, 'loading', false)).toBe('paste')
    expect(pickerView(disconnected, [course(101)], false)).toBe('paste')
  })

  it('switches to the paste input on "Paste a URL instead"', () => {
    expect(pickerView(connected, [course(101)], true)).toBe('paste')
  })
})

describe('splitCourses', () => {
  it('keeps past courses apart, each side in its given order', () => {
    const { current, past } = splitCourses([course(1), course(2, true), course(3), course(4, true)])
    expect(current.map((c) => c.id)).toEqual([1, 3])
    expect(past.map((c) => c.id)).toEqual([2, 4])
  })
})

describe('needsCheck', () => {
  it('checks a pasted URL, never an empty one or one from Moodle', () => {
    expect(needsCheck('https://moodle.example.ac.il/course/view.php?id=7', false)).toBe(true)
    expect(needsCheck('   ', false)).toBe(false)
    expect(needsCheck('https://moodle.example.ac.il/course/view.php?id=7', true)).toBe(false)
  })
})

describe('addFormDraft', () => {
  it('prefills a picked course: its name to edit, its URL fixed and unchecked on Create', () => {
    const c = course(101)
    const draft = addFormDraft(c.name, c.url)
    expect(draft).toEqual({ name: 'Course 101', url: c.url, urlFixed: true })
    expect(needsCheck(draft.url, draft.urlFixed)).toBe(false)
  })

  it('leaves the URL free after an empty paste', () => {
    expect(addFormDraft('', '')).toEqual({ name: '', url: '', urlFixed: false })
  })
})

describe('checkFailure', () => {
  it('gives the typed refusals their protocol codes back', () => {
    expect(checkFailure(new ReconnectError()).code).toBe('moodle_reconnect_required')
    expect(checkFailure(new BlockedError('captcha'))).toMatchObject({
      code: 'site_blocked',
      params: { challengeWindow: 'captcha' },
    })
    const unsupported = new UnsupportedError('x', 'moodle_site_unsupported', {
      reason: 'maintenance',
    })
    expect(checkFailure(unsupported)).toMatchObject({
      code: 'moodle_site_unsupported',
      params: { reason: 'maintenance' },
    })
  })

  it('keeps a coded refusal and a busy lock as they came', () => {
    const refused = new RequestError('no', 'course_not_accessible', { url: 'u', detail: null })
    expect(checkFailure(refused)).toMatchObject({ code: 'course_not_accessible' })
    expect(checkFailure(new MoodleBusyError('busy')).code).toBe('moodle_busy')
  })
})
