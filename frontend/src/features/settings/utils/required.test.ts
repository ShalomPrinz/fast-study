import { describe, it, expect } from 'vitest'
import type { Settings } from '@/services/settings'
import { missingEntries, isInitialized, type RequiredInput } from './required'

const FILLED: RequiredInput = {
  geminiKey: 'g',
  geminiKeyStored: false,
  groqKey: 'q',
  groqKeyStored: false,
  dataRoot: '/data',
  dataRootConfirmed: true,
  driveEnabled: false,
  gdriveRootFolder: '',
  moodleSite: 'https://lemida.biu.ac.il',
  canStoreApiKeys: true,
}

const SETTINGS: Settings = {
  dataRoot: '/data',
  geminiApiKeySet: true,
  groqApiKeySet: true,
  geminiModel: null,
  driveEnabled: null,
  gdriveRootFolder: null,
  autoRun: null,
  nightlyRun: null,
  nightlyHour: null,
  moodleSite: 'https://lemida.biu.ac.il',
}

describe('missingEntries', () => {
  it('is empty when everything is filled', () => {
    expect(missingEntries(FILLED)).toEqual([])
  })

  it('accepts a blank key that is already stored', () => {
    expect(missingEntries({ ...FILLED, geminiKey: '', geminiKeyStored: true })).toEqual([])
  })

  it('treats a whitespace-only key as missing', () => {
    expect(missingEntries({ ...FILLED, groqKey: '   ' })).toEqual(['groqApiKey'])
  })

  it('never requires a key the machine cannot store', () => {
    expect(
      missingEntries({ ...FILLED, geminiKey: '', groqKey: '', canStoreApiKeys: false }),
    ).toEqual([])
  })

  it('requires the data root to be confirmed, not just prefilled', () => {
    expect(missingEntries({ ...FILLED, dataRootConfirmed: false })).toEqual(['dataRoot'])
  })

  it('requires a university, which nothing preselects', () => {
    expect(missingEntries({ ...FILLED, moodleSite: '' })).toEqual(['moodleSite'])
  })

  it('keeps the university required where no key can be stored', () => {
    expect(
      missingEntries({
        ...FILLED,
        geminiKey: '',
        groqKey: '',
        moodleSite: '',
        canStoreApiKeys: false,
      }),
    ).toEqual(['moodleSite'])
  })

  it('requires the Drive folder only while Drive is on', () => {
    expect(missingEntries({ ...FILLED, driveEnabled: false, gdriveRootFolder: '' })).toEqual([])
    expect(missingEntries({ ...FILLED, driveEnabled: true, gdriveRootFolder: '' })).toEqual([
      'gdriveRootFolder',
    ])
  })
})

describe('isInitialized', () => {
  it('is false without a data root, whatever else is set', () => {
    expect(isInitialized({ ...SETTINGS, dataRoot: null }, true)).toBe(false)
    expect(isInitialized({ ...SETTINGS, dataRoot: null }, false)).toBe(false)
  })

  it('is false without a university, keys or no keys', () => {
    expect(isInitialized({ ...SETTINGS, moodleSite: null }, true)).toBe(false)
    expect(isInitialized({ ...SETTINGS, moodleSite: null }, false)).toBe(false)
  })

  it('is true with a data root and both keys', () => {
    expect(isInitialized(SETTINGS, true)).toBe(true)
  })

  it('is false while either key is unset', () => {
    expect(isInitialized({ ...SETTINGS, groqApiKeySet: false }, true)).toBe(false)
    expect(isInitialized({ ...SETTINGS, geminiApiKeySet: false }, true)).toBe(false)
  })

  it('ignores the keys where they cannot be stored', () => {
    const noKeys = { ...SETTINGS, geminiApiKeySet: false, groqApiKeySet: false }
    expect(isInitialized(noKeys, false)).toBe(true)
  })
})
