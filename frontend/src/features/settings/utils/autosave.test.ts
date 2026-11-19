import { describe, it, expect } from 'vitest'
import type { ConfigOptions, Settings } from '@/services/settings'
import { formFromStore } from './patch'
import { approvePatch, approveVisible, autoPatch, mergeApproved } from './autosave'

const STORED: Settings = {
  dataRoot: '/data',
  geminiApiKeySet: true,
  groqApiKeySet: true,
  geminiModel: 'gemini-3.5-flash',
  geminiAutoFallback: null,
  geminiFallbackModels: null,
  summaryFigures: null,
  autoRetry: null,
  autoRetryCount: null,
  autoRetryMinutes: null,
  driveEnabled: false,
  gdriveRootFolder: null,
  autoRun: null,
  autoRemove: null,
  autoRemoveAfter: null,
  moodleSite: 'https://lemida.biu.ac.il',
  errorReports: null,
  privacyConfirmed: false,
  hydrogenPrompted: true,
  aiProvider: null,
  courseStructure: null,
}

const OPTIONS = null as ConfigOptions | null

const base = () => formFromStore(STORED, OPTIONS)

describe('autoPatch', () => {
  it('saves a changed checkbox alone', () => {
    const f = { ...base(), summaryFigures: true }
    expect(autoPatch(f, STORED, true, OPTIONS)).toEqual({ summaryFigures: true })
  })

  it('never carries typed or approved entries', () => {
    const f = {
      ...base(),
      geminiApiKey: 'AIza',
      groqApiKey: 'gsk',
      dataRoot: '/other',
      gdriveRootFolder: 'X',
      moodleSite: 'https://x.ac.il',
      autoRemove: { on: true, what: 'video' as const, after: 'pdf' as const },
    }
    expect(autoPatch(f, STORED, true, OPTIONS)).toEqual({})
  })

  it('holds Drive turned on with no stored folder, saves every other change', () => {
    const f = { ...base(), driveEnabled: true, autoRun: 'off' as const }
    expect(autoPatch(f, STORED, true, OPTIONS)).toEqual({ autoRun: 'off' })
  })

  it('saves Drive on once a folder is stored, and Drive off at once', () => {
    const withFolder = { ...STORED, gdriveRootFolder: 'FastStudy' }
    expect(autoPatch({ ...base(), driveEnabled: true }, withFolder, true, OPTIONS)).toEqual({
      driveEnabled: true,
    })
    const on = { ...STORED, driveEnabled: true }
    expect(autoPatch({ ...base(), driveEnabled: false }, on, true, OPTIONS)).toEqual({
      driveEnabled: false,
    })
  })
})

describe('approvePatch', () => {
  it('stores the Drive toggle and folder together', () => {
    const f = { ...base(), driveEnabled: true, gdriveRootFolder: ' Lectures ' }
    expect(approvePatch('drive', f, STORED)).toEqual({
      driveEnabled: true,
      gdriveRootFolder: 'Lectures',
    })
    expect(approveVisible('drive', f, STORED)).toBe(true)
  })

  it('holds a blank folder but still shows Approve', () => {
    const f = { ...base(), driveEnabled: true }
    expect(approvePatch('drive', f, STORED)).toEqual({})
    expect(approveVisible('drive', f, STORED)).toBe(true)
  })

  it('shows nothing without an edit', () => {
    for (const id of ['geminiKey', 'groqKey', 'dataRoot', 'drive', 'site', 'retry'] as const) {
      expect(approveVisible(id, base(), STORED)).toBe(false)
    }
  })

  it('stores a typed key, data folder and site', () => {
    const f = { ...base(), geminiApiKey: ' k ', dataRoot: '/new', moodleSite: 'https://a.ac.il' }
    expect(approvePatch('geminiKey', f, STORED)).toEqual({ geminiApiKey: 'k' })
    expect(approvePatch('dataRoot', f, STORED)).toEqual({ dataRoot: '/new' })
    expect(approvePatch('site', f, STORED)).toEqual({ moodleSite: 'https://a.ac.il' })
  })
})

describe('retry numbers', () => {
  const edited = (patch: object) => {
    const b = base()
    return { ...b, autoRetry: { ...b.autoRetry, ...patch } }
  }

  it('wait for Approve while the switch saves at once', () => {
    const f = edited({ count: 10, minutes: 7, on: !base().autoRetry.on })
    expect(autoPatch(f, STORED, true, OPTIONS)).toEqual({ autoRetry: f.autoRetry.on })
    expect(approveVisible('retry', f, STORED)).toBe(true)
    expect(approvePatch('retry', f, STORED)).toEqual({ autoRetryCount: 10, autoRetryMinutes: 7 })
  })

  it('hold an invalid box: Approve shows but stores nothing', () => {
    const f = edited({ count: NaN })
    expect(autoPatch(f, STORED, true, OPTIONS)).toEqual({})
    expect(approveVisible('retry', f, STORED)).toBe(true)
    expect(approvePatch('retry', f, STORED)).toEqual({})
  })
})

describe('mergeApproved', () => {
  it('clears the key it stored and leaves every other edit', () => {
    const f = { ...base(), geminiApiKey: 'k', summaryFigures: true, autoRun: 'off' as const }
    const out = mergeApproved(f, STORED, { geminiApiKey: 'k' })
    expect(out.geminiApiKey).toBe('')
    expect(out.summaryFigures).toBe(true)
    expect(out.autoRun).toBe('off')
  })

  it('keeps text typed after the approve was sent', () => {
    const f = { ...base(), dataRoot: '/newer' }
    expect(mergeApproved(f, { ...STORED, dataRoot: '/new' }, { dataRoot: '/new' }).dataRoot).toBe(
      '/newer',
    )
  })

  it('takes the normalized folder the store answered', () => {
    const f = { ...base(), dataRoot: '/new/' }
    expect(mergeApproved(f, { ...STORED, dataRoot: '/new' }, { dataRoot: '/new/' }).dataRoot).toBe(
      '/new',
    )
  })
})
