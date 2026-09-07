import { describe, it, expect } from 'vitest'
import { storeBody, type Settings } from '@/services/settings'
import { buildPatch, type SettingsForm } from './patch'

const STORED: Settings = {
  dataRoot: '/data',
  geminiApiKeySet: true,
  groqApiKeySet: true,
  geminiModel: 'gemini-3.5-flash',
  driveEnabled: false,
  gdriveRootFolder: null,
  autoRun: null,
  nightlyRun: null,
  nightlyHour: null,
}

const UNCHANGED: SettingsForm = {
  geminiApiKey: '',
  groqApiKey: '',
  dataRoot: '/data',
  driveEnabled: false,
  gdriveRootFolder: '',
  geminiModel: 'gemini-3.5-flash',
  autoRun: 'full',
  nightlyRun: true,
  nightlyHour: 3,
}

describe('buildPatch', () => {
  it('sends nothing when nothing changed', () => {
    expect(buildPatch(UNCHANGED, STORED)).toEqual({})
  })

  it('never clears a stored key just because its write-only field is blank', () => {
    expect(buildPatch({ ...UNCHANGED, geminiApiKey: '   ' }, STORED).geminiApiKey).toBeUndefined()
  })

  it('sends a typed key, trimmed', () => {
    expect(buildPatch({ ...UNCHANGED, groqApiKey: ' gsk_abc ' }, STORED).groqApiKey).toBe('gsk_abc')
  })

  it('treats an unset nightly switch as on and an unset hour as 03:00', () => {
    expect(buildPatch(UNCHANGED, STORED)).toEqual({})
    expect(buildPatch({ ...UNCHANGED, nightlyRun: false }, STORED)).toEqual({ nightlyRun: false })
  })

  it('diffs the nightly hour against the stored value, clamping an out-of-range one to 3', () => {
    expect(buildPatch(UNCHANGED, { ...STORED, nightlyHour: 99 })).toEqual({})
    expect(buildPatch({ ...UNCHANGED, nightlyHour: 21 }, { ...STORED, nightlyHour: 21 })).toEqual(
      {},
    )
    expect(buildPatch({ ...UNCHANGED, nightlyHour: 0 }, STORED)).toEqual({ nightlyHour: 0 })
  })

  it('sends the nightly hour as a number, which is what the store accepts', () => {
    const patch = buildPatch({ ...UNCHANGED, nightlyHour: 21 }, STORED)
    expect(patch.nightlyHour).toBe(21)
    expect(storeBody(patch)).toEqual({ nightly_hour: 21 })
  })

  it('sends only the changed fields', () => {
    const patch = buildPatch(
      { ...UNCHANGED, dataRoot: '/other', driveEnabled: true, gdriveRootFolder: 'Lectures' },
      STORED,
    )
    expect(patch).toEqual({ dataRoot: '/other', driveEnabled: true, gdriveRootFolder: 'Lectures' })
  })
})
