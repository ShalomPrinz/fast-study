import { describe, it, expect } from 'vitest'
import { storeBody, type ConfigOptions, type Settings } from '@/services/settings'
import { buildPatch, formFromStore, withOptions, withSavedSite, type SettingsForm } from './patch'

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
  moodleSite: 'https://lemida.biu.ac.il',
  errorReports: null,
  privacyConfirmed: false,
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
  moodleSite: 'https://lemida.biu.ac.il',
  errorReports: false,
  privacyConfirmed: false,
}

describe('buildPatch', () => {
  it('sends nothing when nothing changed', () => {
    expect(buildPatch(UNCHANGED, STORED)).toEqual({})
  })

  it('never clears a stored key just because its write-only field is blank', () => {
    expect(buildPatch({ ...UNCHANGED, geminiApiKey: '   ' }, STORED).geminiApiKey).toBeUndefined()
  })

  // The same rule is what lets the init wall save at all where no key can be stored: its key fields
  // are never rendered, so both stay blank and neither reaches the store.
  it('omits both key fields entirely when neither was typed into', () => {
    const patch = buildPatch({ ...UNCHANGED, dataRoot: '/other' }, STORED)
    expect('geminiApiKey' in patch).toBe(false)
    expect('groqApiKey' in patch).toBe(false)
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

  it('sends a default Drive folder nobody typed once Drive is on, and no folder while it is off', () => {
    const defaulted = { ...UNCHANGED, gdriveRootFolder: 'FastStudy' }
    expect(buildPatch({ ...defaulted, driveEnabled: true }, STORED)).toEqual({
      driveEnabled: true,
      gdriveRootFolder: 'FastStudy',
    })
    expect(buildPatch(defaulted, STORED)).toEqual({})
  })

  it('sends a newly chosen site', () => {
    expect(buildPatch({ ...UNCHANGED, moodleSite: 'https://moodle.tau.ac.il' }, STORED)).toEqual({
      moodleSite: 'https://moodle.tau.ac.il',
    })
  })

  it('clears a stored site when no university is chosen, and leaves it while a choice is unsavable', () => {
    expect(buildPatch({ ...UNCHANGED, moodleSite: '' }, STORED)).toEqual({ moodleSite: '' })
    expect(buildPatch({ ...UNCHANGED, moodleSite: null }, STORED)).toEqual({})
    expect(buildPatch({ ...UNCHANGED, moodleSite: '' }, { ...STORED, moodleSite: null })).toEqual(
      {},
    )
  })

  it('treats unset error reports as off, so only switching them on is stored', () => {
    expect(buildPatch(UNCHANGED, STORED)).toEqual({})
    expect(buildPatch({ ...UNCHANGED, errorReports: true }, STORED)).toEqual({
      errorReports: true,
    })
    expect(buildPatch(UNCHANGED, { ...STORED, errorReports: true })).toEqual({
      errorReports: false,
    })
  })

  it('stores a newly answered privacy policy, and never unsets an answered one', () => {
    expect(buildPatch({ ...UNCHANGED, privacyConfirmed: true }, STORED)).toEqual({
      privacyConfirmed: true,
    })
    expect(buildPatch(UNCHANGED, { ...STORED, privacyConfirmed: true })).toEqual({})
  })
})

const OPTIONS: ConfigOptions = {
  providers: [],
  geminiModels: ['gemini-3.5-flash', 'gemini-3.5-pro'],
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
    expect(buildPatch(form, retired)).toEqual({ geminiModel: 'gemini-3.5-flash' })
  })

  it('keeps a listed model that is not the first', () => {
    const form = formFromStore({ ...STORED, geminiModel: 'gemini-3.5-pro' }, OPTIONS)
    expect(form.geminiModel).toBe('gemini-3.5-pro')
  })

  // After a save the page re-reads the form from the store's fresh answer, which already holds
  // another writer's change, so the next save carries only what this page edits.
  it('never reverts a field another writer changed once the form is re-read after a save', () => {
    const fresh = { ...STORED, gdriveRootFolder: 'Harness-B', nightlyRun: true }
    const next = { ...formFromStore(fresh, OPTIONS), nightlyRun: false }
    expect(buildPatch(next, fresh)).toEqual({ nightlyRun: false })
  })
})

// The options come from the backend and the store from the database, so the page renders with the
// store alone while the backend is down and takes the options when it returns.
describe('the form without options', () => {
  it('keeps the stored model untouched, so Save never sends one', () => {
    const retired = { ...STORED, geminiModel: 'gemini-2.0-flash-retired' }
    const form = formFromStore(retired, null)
    expect(form.geminiModel).toBe('gemini-2.0-flash-retired')
    expect(buildPatch({ ...form, dataRoot: '/elsewhere' }, retired)).toEqual({
      dataRoot: '/elsewhere',
    })
    const unset = { ...STORED, geminiModel: null }
    expect(buildPatch(formFromStore(unset, null), unset)).toEqual({})
  })

  it('resolves only the model once the options arrive, keeping every edit', () => {
    const retired = { ...STORED, geminiModel: 'gemini-2.0-flash-retired' }
    const edited = { ...formFromStore(retired, null), dataRoot: '/elsewhere' }
    expect(withOptions(edited, retired, OPTIONS)).toEqual({
      ...edited,
      geminiModel: 'gemini-3.5-flash',
    })
    const listed = formFromStore({ ...STORED, geminiModel: 'gemini-3.5-pro' }, null)
    expect(withOptions(listed, STORED, OPTIONS)).toBe(listed)
  })
})

describe('withSavedSite', () => {
  it('keeps every other unsaved edit, and the next Save no longer sends the site', () => {
    const edited = {
      ...UNCHANGED,
      dataRoot: '/elsewhere',
      nightlyHour: 5,
      moodleSite: 'https://moodle.bgu.ac.il/moodle',
    }
    const saved = { ...STORED, moodleSite: 'https://moodle.bgu.ac.il/moodle' }
    expect(buildPatch(withSavedSite(edited, saved), saved)).toEqual({
      dataRoot: '/elsewhere',
      nightlyHour: 5,
    })
  })

  it('reverts the site to the store, for a cancelled switch', () => {
    const picked = { ...UNCHANGED, geminiModel: 'other', moodleSite: '' }
    expect(withSavedSite(picked, STORED)).toEqual({ ...picked, moodleSite: STORED.moodleSite })
  })
})
