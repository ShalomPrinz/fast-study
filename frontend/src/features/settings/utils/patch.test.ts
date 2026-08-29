import { describe, it, expect } from 'vitest'
import type { Settings } from '@/services/settings'
import { buildPatch, type SettingsForm } from './patch'

const STORED: Settings = {
  dataRoot: '/data',
  geminiApiKeySet: true,
  groqApiKeySet: true,
  geminiModel: 'gemini-3.5-flash',
  driveEnabled: false,
  gdriveRootFolder: null,
  uiLanguage: 'he',
  autoRunOnBoot: true,
  runnerControlsVisible: false,
}

const UNCHANGED: SettingsForm = {
  geminiApiKey: '',
  groqApiKey: '',
  dataRoot: '/data',
  driveEnabled: false,
  gdriveRootFolder: '',
  geminiModel: 'gemini-3.5-flash',
  uiLanguage: 'he',
  autoRunOnBoot: true,
  runnerControlsVisible: false,
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

  it('sends only the changed fields', () => {
    const patch = buildPatch(
      { ...UNCHANGED, dataRoot: '/other', driveEnabled: true, gdriveRootFolder: 'Lectures' },
      STORED,
    )
    expect(patch).toEqual({ dataRoot: '/other', driveEnabled: true, gdriveRootFolder: 'Lectures' })
  })

  it('records the answer to a setting the store has never held', () => {
    const blank: Settings = { ...STORED, autoRunOnBoot: null, runnerControlsVisible: null }
    expect(buildPatch(UNCHANGED, blank)).toEqual({
      autoRunOnBoot: true,
      runnerControlsVisible: false,
    })
  })

  it('records a language switch', () => {
    expect(buildPatch({ ...UNCHANGED, uiLanguage: 'en' }, STORED).uiLanguage).toBe('en')
  })
})
