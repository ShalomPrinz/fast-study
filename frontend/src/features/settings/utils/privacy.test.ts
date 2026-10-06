import { describe, it, expect } from 'vitest'
import type { SavedSettings } from '@/services/settings'
import { privacyAnswer, readToEnd, restartNotice, wallMustAskPrivacy } from './privacy'

describe('readToEnd', () => {
  it('counts a policy that fits without scrolling as read at once', () => {
    expect(readToEnd({ scrollTop: 0, clientHeight: 400, scrollHeight: 400 })).toBe(true)
  })

  it('holds the confirm until the end is in view, allowing a sub-pixel shortfall', () => {
    expect(readToEnd({ scrollTop: 0, clientHeight: 400, scrollHeight: 900 })).toBe(false)
    expect(readToEnd({ scrollTop: 300, clientHeight: 400, scrollHeight: 900 })).toBe(false)
    expect(readToEnd({ scrollTop: 499.4, clientHeight: 400, scrollHeight: 900 })).toBe(true)
  })
})

describe('privacyAnswer', () => {
  it('turns reports on for confirm and off for decline, and marks the policy read either way', () => {
    expect(privacyAnswer(true)).toEqual({ errorReports: true, privacyConfirmed: true })
    expect(privacyAnswer(false)).toEqual({ errorReports: false, privacyConfirmed: true })
  })
})

describe('wallMustAskPrivacy', () => {
  it('asks only while unanswered, and never where the switch is hidden', () => {
    expect(wallMustAskPrivacy(false, true)).toBe(true)
    expect(wallMustAskPrivacy(true, true)).toBe(false)
    expect(wallMustAskPrivacy(false, false)).toBe(false)
  })
})

describe('restartNotice', () => {
  const saved = { errorReports: true, errorReportsRestartNeeded: true } as SavedSettings

  it('names the new state only when some part of the app missed it', () => {
    expect(restartNotice(saved)).toBe('on')
    expect(restartNotice({ ...saved, errorReports: false })).toBe('off')
    expect(restartNotice({ ...saved, errorReports: null })).toBe('off')
    expect(restartNotice({ ...saved, errorReportsRestartNeeded: false })).toBeNull()
  })
})
