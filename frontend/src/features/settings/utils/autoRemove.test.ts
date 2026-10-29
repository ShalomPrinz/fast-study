import { describe, it, expect } from 'vitest'
import type { Settings } from '@/services/settings'
import {
  AUTO_REMOVE_CHECKED,
  autoRemoveApply,
  autoRemoveBlock,
  autoRemoveComplete,
  autoRemoveDirty,
  autoRemoveFromStore,
  autoRemovePatch,
  autoRemoveWidens,
  type AutoRemoveForm,
} from './autoRemove'

const BASE: Settings = {
  dataRoot: '/data',
  geminiApiKeySet: true,
  groqApiKeySet: true,
  geminiModel: null,
  driveEnabled: true,
  gdriveRootFolder: null,
  autoRun: null,
  geminiAutoFallback: null,
  autoRemove: null,
  autoRemoveAfter: null,
  moodleSite: null,
  errorReports: null,
  privacyConfirmed: false,
  aiProvider: null,
  courseStructure: null,
}

const stored = (autoRemove: string | null, autoRemoveAfter: string | null): Settings => ({
  ...BASE,
  autoRemove,
  autoRemoveAfter,
})
const rule = (what: 'video' | 'audio', after: 'pdf' | 'drive' | null): AutoRemoveForm => ({
  on: true,
  what,
  after,
})
const OFF: AutoRemoveForm = { on: false, what: 'video', after: null }

describe('autoRemoveWidens', () => {
  it('widens when an off or unset rule turns on', () => {
    expect(autoRemoveWidens(rule('video', 'drive'), stored(null, null))).toBe(true)
    expect(autoRemoveWidens(rule('video', 'pdf'), stored('off', 'pdf'))).toBe(true)
  })

  it('widens on more files or an earlier timing, either dimension alone', () => {
    expect(autoRemoveWidens(rule('audio', 'drive'), stored('video', 'drive'))).toBe(true)
    expect(autoRemoveWidens(rule('video', 'pdf'), stored('video', 'drive'))).toBe(true)
    expect(autoRemoveWidens(rule('audio', 'drive'), stored('video', 'pdf'))).toBe(true)
  })

  it('does not widen when narrowing, unchanged or turning off', () => {
    expect(autoRemoveWidens(rule('video', 'pdf'), stored('audio', 'pdf'))).toBe(false)
    expect(autoRemoveWidens(rule('video', 'drive'), stored('video', 'pdf'))).toBe(false)
    expect(autoRemoveWidens(rule('video', 'pdf'), stored('video', 'pdf'))).toBe(false)
    expect(autoRemoveWidens(OFF, stored('audio', 'pdf'))).toBe(false)
  })

  it('never widens with no timing chosen, since nothing can be saved yet', () => {
    expect(autoRemoveWidens(AUTO_REMOVE_CHECKED, stored(null, null))).toBe(false)
  })
})

describe('autoRemovePatch', () => {
  it('sends both values for an on rule, and only `off` once unchecked', () => {
    expect(autoRemovePatch(rule('audio', 'pdf'), stored(null, null), true)).toEqual({
      autoRemove: 'audio',
      autoRemoveAfter: 'pdf',
    })
    expect(autoRemovePatch(OFF, stored('video', 'pdf'), true)).toEqual({ autoRemove: 'off' })
  })

  it('sends nothing while unchanged, or unchecked over an unset store', () => {
    expect(autoRemovePatch(rule('video', 'pdf'), stored('video', 'pdf'), true)).toEqual({})
    expect(autoRemovePatch(OFF, stored(null, null), true)).toEqual({})
  })

  it('sends nothing while incomplete: no timing, or Drive chosen with Drive off', () => {
    expect(autoRemovePatch(AUTO_REMOVE_CHECKED, stored(null, null), true)).toEqual({})
    expect(autoRemovePatch(rule('video', 'drive'), stored(null, null), false)).toEqual({})
  })
})

describe('the section state', () => {
  it('reads an unknown or off store as unchecked, and keeps a half-stored timing unchosen', () => {
    expect(autoRemoveFromStore(stored('bogus', 'pdf')).on).toBe(false)
    expect(autoRemoveFromStore(stored('off', 'pdf')).on).toBe(false)
    expect(autoRemoveFromStore(stored('audio', 'bogus'))).toEqual(rule('audio', null))
  })

  it('is dirty only for a real difference; two unchecked forms are equal', () => {
    expect(autoRemoveDirty({ on: false, what: 'audio', after: 'pdf' }, stored('off', null))).toBe(
      false,
    )
    expect(autoRemoveDirty(AUTO_REMOVE_CHECKED, stored(null, null))).toBe(true)
    expect(autoRemoveDirty(rule('video', 'drive'), stored('video', 'pdf'))).toBe(true)
  })

  it('is complete once a timing is chosen that the form allows', () => {
    expect(autoRemoveComplete(OFF, false)).toBe(true)
    expect(autoRemoveComplete(AUTO_REMOVE_CHECKED, true)).toBe(false)
    expect(autoRemoveComplete(rule('video', 'drive'), false)).toBe(false)
    expect(autoRemoveComplete(rule('video', 'drive'), true)).toBe(true)
  })
})

describe('autoRemoveApply', () => {
  const driveOff = (s: Settings): Settings => ({ ...s, driveEnabled: false })

  it('saves a complete edit, and does nothing for an incomplete one', () => {
    expect(autoRemoveApply(rule('video', 'pdf'), stored(null, null), true)).toBe('save')
    expect(autoRemoveApply(AUTO_REMOVE_CHECKED, stored(null, null), true)).toBeNull()
  })

  it('re-runs the sweep while the section matches a stored rule that is on', () => {
    expect(autoRemoveApply(rule('video', 'pdf'), stored('video', 'pdf'), true)).toBe('sweep')
    expect(autoRemoveApply(OFF, stored('off', 'pdf'), true)).toBe('unchanged')
    expect(autoRemoveApply(rule('audio', null), stored('audio', null), true)).toBe('unchanged')
  })

  it('leaves "after Drive" to the page Save while the Drive toggle is unsaved', () => {
    expect(autoRemoveApply(rule('video', 'drive'), driveOff(stored(null, null)), true)).toBe(
      'needs-page-save',
    )
    expect(autoRemoveApply(rule('video', 'drive'), stored(null, null), true)).toBe('save')
    expect(autoRemoveApply(rule('video', 'pdf'), driveOff(stored(null, null)), true)).toBe('save')
  })
})

describe('autoRemoveBlock', () => {
  it('names no timing chosen, whatever the mode', () => {
    expect(autoRemoveBlock(AUTO_REMOVE_CHECKED, true)).toBe('choose-when')
    expect(autoRemoveBlock(rule('audio', null), false)).toBe('choose-when')
  })

  it('names "after Drive" with Drive off per mode', () => {
    expect(autoRemoveBlock(rule('video', 'drive'), false)).toBe('drive-off-video')
    expect(autoRemoveBlock(rule('audio', 'drive'), false)).toBe('drive-off-audio')
  })

  it('is null when complete or unchecked', () => {
    expect(autoRemoveBlock(rule('audio', 'drive'), true)).toBeNull()
    expect(autoRemoveBlock(rule('video', 'pdf'), false)).toBeNull()
    expect(autoRemoveBlock(OFF, false)).toBeNull()
  })
})
