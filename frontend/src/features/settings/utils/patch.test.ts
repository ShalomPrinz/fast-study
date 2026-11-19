import { describe, it, expect } from 'vitest'
import { ownerBodies, storeBody, type ConfigOptions, type Settings } from '@/services/settings'
import {
  buildPatch,
  formFromStore,
  wallPatch,
  withOptions,
  withSavedSite,
  type SettingsForm,
} from './patch'
import { effectiveFallback } from './geminiOrder'

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

const UNCHANGED: SettingsForm = {
  geminiApiKey: '',
  groqApiKey: '',
  dataRoot: '/data',
  driveEnabled: false,
  gdriveRootFolder: '',
  geminiModel: 'gemini-3.5-flash',
  geminiFallbackModels: ['gemini-3.5-pro'],
  summaryFigures: false,
  autoRetry: { on: true, count: 3, minutes: 10 },
  autoRun: 'full',
  autoRemove: { on: false, what: 'video', after: null },
  moodleSite: 'https://lemida.biu.ac.il',
  errorReports: false,
  privacyConfirmed: false,
  aiProvider: 'claude',
  courseStructure: 'split',
}

describe('buildPatch', () => {
  it('derives the list from an unset store: auto-fallback unset or true, every other model after the main', () => {
    expect(formFromStore(STORED, OPTIONS).geminiFallbackModels).toEqual(['gemini-3.5-pro'])
    expect(buildPatch(UNCHANGED, STORED, true, OPTIONS)).toEqual({})
  })

  it('derives an empty list when auto-fallback was stored off', () => {
    const stored = { ...STORED, geminiAutoFallback: false }
    expect(formFromStore(stored, OPTIONS).geminiFallbackModels).toEqual([])
    expect(buildPatch({ ...UNCHANGED, geminiFallbackModels: [] }, stored, true, OPTIONS)).toEqual(
      {},
    )
  })

  it('wraps the derived order round the curated list', () => {
    const three = {
      ...OPTIONS,
      geminiModels: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ],
    }
    expect(effectiveFallback({ ...STORED, geminiModel: 'b' }, three)).toEqual(['c', 'a'])
    expect(effectiveFallback({ ...STORED, geminiModel: 'c' }, three)).toEqual(['a', 'b'])
  })

  it('drops retired ids, the main model and duplicates from a saved list', () => {
    const stored = {
      ...STORED,
      geminiFallbackModels: ['old', 'gemini-3.5-flash', 'gemini-3.5-pro', 'gemini-3.5-pro'],
    }
    expect(effectiveFallback(stored, OPTIONS)).toEqual(['gemini-3.5-pro'])
  })

  it('writes the list explicitly with the model whenever either differs', () => {
    expect(buildPatch({ ...UNCHANGED, geminiFallbackModels: [] }, STORED, true, OPTIONS)).toEqual({
      geminiModel: 'gemini-3.5-flash',
      geminiFallbackModels: [],
    })
    expect(
      buildPatch(
        { ...UNCHANGED, geminiModel: 'gemini-3.5-pro', geminiFallbackModels: ['gemini-3.5-flash'] },
        STORED,
        true,
        OPTIONS,
      ),
    ).toEqual({ geminiModel: 'gemini-3.5-pro', geminiFallbackModels: ['gemini-3.5-flash'] })
  })

  it('leaves the list alone when the form holds none (the wall)', () => {
    expect(
      buildPatch(
        { ...UNCHANGED, geminiModel: 'gemini-3.5-pro', geminiFallbackModels: null },
        STORED,
        true,
        OPTIONS,
      ),
    ).toEqual({ geminiModel: 'gemini-3.5-pro' })
  })

  it('never writes the retired auto-fallback flag, and sends the list to the backend', () => {
    expect(storeBody({ geminiFallbackModels: [] })).toEqual({ gemini_fallback_models: [] })
    expect(ownerBodies({ geminiFallbackModels: [] }).backend).toEqual({
      gemini_fallback_models: [],
    })
  })

  it('treats unset summary figures as off: checking sends true, leaving it sends nothing', () => {
    expect(formFromStore(STORED, OPTIONS).summaryFigures).toBe(false)
    expect(buildPatch({ ...UNCHANGED, summaryFigures: true }, STORED, true, OPTIONS)).toEqual({
      summaryFigures: true,
    })
    expect(storeBody({ summaryFigures: true })).toEqual({ summary_figures: true })
    const on = { ...STORED, summaryFigures: true }
    expect(buildPatch({ ...UNCHANGED, summaryFigures: false }, on, true, OPTIONS)).toEqual({
      summaryFigures: false,
    })
  })

  it('sends nothing when nothing changed', () => {
    expect(buildPatch(UNCHANGED, STORED, true, OPTIONS)).toEqual({})
  })

  it('never clears a stored key just because its write-only field is blank', () => {
    expect(
      buildPatch({ ...UNCHANGED, geminiApiKey: '   ' }, STORED, true, OPTIONS).geminiApiKey,
    ).toBeUndefined()
  })

  // The same rule is what lets the init wall save at all where no key can be stored: its key fields
  // are never rendered, so both stay blank and neither reaches the store.
  it('omits both key fields entirely when neither was typed into', () => {
    const patch = buildPatch({ ...UNCHANGED, dataRoot: '/other' }, STORED, true, OPTIONS)
    expect('geminiApiKey' in patch).toBe(false)
    expect('groqApiKey' in patch).toBe(false)
  })

  it('sends a typed key, trimmed', () => {
    expect(
      buildPatch({ ...UNCHANGED, groqApiKey: ' gsk_abc ' }, STORED, true, OPTIONS).groqApiKey,
    ).toBe('gsk_abc')
  })

  it('sends nothing for an unchanged form', () => {
    expect(buildPatch(UNCHANGED, STORED, true, OPTIONS)).toEqual({})
  })

  it('sends only the changed fields', () => {
    const patch = buildPatch(
      { ...UNCHANGED, dataRoot: '/other', driveEnabled: true, gdriveRootFolder: 'Lectures' },
      STORED,
      true,
      OPTIONS,
    )
    expect(patch).toEqual({ dataRoot: '/other', driveEnabled: true, gdriveRootFolder: 'Lectures' })
  })

  it('sends a default Drive folder nobody typed once Drive is on, and no folder while it is off', () => {
    const defaulted = { ...UNCHANGED, gdriveRootFolder: 'FastStudy' }
    expect(buildPatch({ ...defaulted, driveEnabled: true }, STORED, true, OPTIONS)).toEqual({
      driveEnabled: true,
      gdriveRootFolder: 'FastStudy',
    })
    expect(buildPatch(defaulted, STORED, true, OPTIONS)).toEqual({})
  })

  it('sends a newly chosen site', () => {
    expect(
      buildPatch({ ...UNCHANGED, moodleSite: 'https://moodle.tau.ac.il' }, STORED, true, OPTIONS),
    ).toEqual({
      moodleSite: 'https://moodle.tau.ac.il',
    })
  })

  it('clears a stored site when no university is chosen, and leaves it while a choice is unsavable', () => {
    expect(buildPatch({ ...UNCHANGED, moodleSite: '' }, STORED, true, OPTIONS)).toEqual({
      moodleSite: '',
    })
    expect(buildPatch({ ...UNCHANGED, moodleSite: null }, STORED, true, OPTIONS)).toEqual({})
    expect(
      buildPatch({ ...UNCHANGED, moodleSite: '' }, { ...STORED, moodleSite: null }, true, OPTIONS),
    ).toEqual({})
  })

  it('treats unset error reports as off, so only switching them on is stored', () => {
    expect(buildPatch(UNCHANGED, STORED, true, OPTIONS)).toEqual({})
    expect(buildPatch({ ...UNCHANGED, errorReports: true }, STORED, true, OPTIONS)).toEqual({
      errorReports: true,
    })
    expect(buildPatch(UNCHANGED, { ...STORED, errorReports: true }, true, OPTIONS)).toEqual({
      errorReports: false,
    })
  })

  it('never sends error reports without the launcher, whose store alone has the setting', () => {
    expect(buildPatch({ ...UNCHANGED, errorReports: true }, STORED, false, OPTIONS)).toEqual({})
    expect(buildPatch(UNCHANGED, { ...STORED, errorReports: true }, false, OPTIONS)).toEqual({})
  })

  it('stores a changed AI chat, and reads nothing stored as Claude', () => {
    expect(buildPatch({ ...UNCHANGED, aiProvider: 'gemini' }, STORED, true, OPTIONS)).toEqual({
      aiProvider: 'gemini',
    })
    expect(buildPatch(UNCHANGED, { ...STORED, aiProvider: 'copilot' }, true, OPTIONS)).toEqual({})
  })

  it('stores a changed course structure, and reads nothing stored as split', () => {
    expect(
      buildPatch({ ...UNCHANGED, courseStructure: 'lectures_all' }, STORED, true, OPTIONS),
    ).toEqual({
      courseStructure: 'lectures_all',
    })
    expect(buildPatch(UNCHANGED, { ...STORED, courseStructure: 'bogus' }, true, OPTIONS)).toEqual(
      {},
    )
  })

  it('stores a newly answered privacy policy, and never unsets an answered one', () => {
    expect(buildPatch({ ...UNCHANGED, privacyConfirmed: true }, STORED, true, OPTIONS)).toEqual({
      privacyConfirmed: true,
    })
    expect(buildPatch(UNCHANGED, { ...STORED, privacyConfirmed: true }, true, OPTIONS)).toEqual({})
  })
})

const OPTIONS: ConfigOptions = {
  providers: [],
  geminiModels: [
    { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash' },
    { id: 'gemini-3.5-pro', name: 'Gemini 3.5 Pro' },
  ],
}

describe('formFromStore', () => {
  it('reads the store as an unchanged form', () => {
    expect(formFromStore(STORED, OPTIONS)).toEqual(UNCHANGED)
  })

  it('reads unset error reports as off and a stored yes as on', () => {
    expect(formFromStore(STORED, OPTIONS).errorReports).toBe(false)
    expect(formFromStore({ ...STORED, errorReports: true }, OPTIONS).errorReports).toBe(true)
  })

  it('reads a model the options no longer list as the first one, so Save replaces it', () => {
    const retired = { ...STORED, geminiModel: 'gemini-2.0-flash-retired' }
    const form = formFromStore(retired, OPTIONS)
    expect(form.geminiModel).toBe('gemini-3.5-flash')
    expect(buildPatch(form, retired, true, OPTIONS)).toEqual({
      geminiModel: 'gemini-3.5-flash',
      geminiFallbackModels: ['gemini-3.5-pro'],
    })
  })

  it('keeps a listed model that is not the first', () => {
    const form = formFromStore({ ...STORED, geminiModel: 'gemini-3.5-pro' }, OPTIONS)
    expect(form.geminiModel).toBe('gemini-3.5-pro')
  })

  // After a save the page re-reads the form from the store's fresh answer, which already holds
  // another writer's change, so the next save carries only what this page edits.
  it('never reverts a field another writer changed once the form is re-read after a save', () => {
    const fresh = { ...STORED, gdriveRootFolder: 'Harness-B', autoRun: 'full' }
    const next = { ...formFromStore(fresh, OPTIONS), autoRun: 'off' as const }
    expect(buildPatch(next, fresh, true, OPTIONS)).toEqual({ autoRun: 'off' })
  })
})

// The options come from the backend and the store from the database, so the page renders with the
// store alone while the backend is down and takes the options when it returns.
describe('the form without options', () => {
  it('keeps the stored model untouched, so Save never sends one', () => {
    const retired = { ...STORED, geminiModel: 'gemini-2.0-flash-retired' }
    const form = formFromStore(retired, null)
    expect(form.geminiModel).toBe('gemini-2.0-flash-retired')
    expect(buildPatch({ ...form, dataRoot: '/elsewhere' }, retired, true, OPTIONS)).toEqual({
      dataRoot: '/elsewhere',
    })
    const unset = { ...STORED, geminiModel: null }
    expect(buildPatch(formFromStore(unset, null), unset, true, OPTIONS)).toEqual({})
  })

  it('resolves only the model once the options arrive, keeping every edit', () => {
    const retired = { ...STORED, geminiModel: 'gemini-2.0-flash-retired' }
    const edited = { ...formFromStore(retired, null), dataRoot: '/elsewhere' }
    expect(withOptions(edited, retired, OPTIONS)).toEqual({
      ...edited,
      geminiModel: 'gemini-3.5-flash',
      geminiFallbackModels: ['gemini-3.5-pro'],
    })
    const onPro = { ...STORED, geminiModel: 'gemini-3.5-pro' }
    const listed = formFromStore(onPro, null)
    expect(withOptions(listed, onPro, OPTIONS)).toEqual({
      ...listed,
      geminiFallbackModels: ['gemini-3.5-flash'],
    })
  })
})

describe('withSavedSite', () => {
  it('keeps every other unsaved edit, and the next Save no longer sends the site', () => {
    const edited = {
      ...UNCHANGED,
      dataRoot: '/elsewhere',
      autoRun: 'off' as const,
      moodleSite: 'https://moodle.bgu.ac.il/moodle',
    }
    const saved = { ...STORED, moodleSite: 'https://moodle.bgu.ac.il/moodle' }
    expect(buildPatch(withSavedSite(edited, saved), saved, true, OPTIONS)).toEqual({
      dataRoot: '/elsewhere',
      autoRun: 'off',
    })
  })

  it('reverts the site to the store, for a cancelled switch', () => {
    const picked = { ...UNCHANGED, geminiModel: 'other', moodleSite: '' }
    expect(withSavedSite(picked, STORED)).toEqual({ ...picked, moodleSite: STORED.moodleSite })
  })
})

describe('wallPatch', () => {
  it('stores errorReports explicitly and marks the Gemini offer answered', () => {
    const patch = wallPatch({ ...UNCHANGED, errorReports: true }, STORED, true, OPTIONS)
    expect(patch.errorReports).toBe(true)
    expect(patch.hydrogenPrompted).toBe(true)
  })

  it('sends neither launcher-only field without the launcher', () => {
    const patch = wallPatch(UNCHANGED, STORED, false, OPTIONS)
    expect('errorReports' in patch).toBe(false)
    expect('hydrogenPrompted' in patch).toBe(false)
  })
})
