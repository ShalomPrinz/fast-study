// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  readPreference,
  resolvePreference,
  seedPreferences,
  writePreference,
} from './uiPreferences'

beforeEach(() => {
  localStorage.clear()
})

describe('resolvePreference', () => {
  it('lets a stored choice outrank both the store and the shipped default', () => {
    expect(resolvePreference('false', true, true)).toBe(false)
    expect(resolvePreference('true', false, false)).toBe(true)
  })

  it('falls back to the store when the profile has never answered', () => {
    expect(resolvePreference(null, false, true)).toBe(false)
    expect(resolvePreference(null, true, false)).toBe(true)
  })

  it('falls back to the shipped default when the store is null too', () => {
    expect(resolvePreference(null, null, true)).toBe(true)
    expect(resolvePreference(null, null, false)).toBe(false)
  })

  it('treats an unrecognised stored value as no answer', () => {
    expect(resolvePreference('yes', null, false)).toBe(false)
  })
})

describe('the shipped defaults', () => {
  it('is auto-run on and runner controls hidden', () => {
    expect(readPreference('autoRunOnBoot')).toBe(true)
    expect(readPreference('runnerControlsVisible')).toBe(false)
  })
})

describe('seedPreferences', () => {
  it("pins the store's answers on a profile that has none", () => {
    seedPreferences({ autoRunOnBoot: false, runnerControlsVisible: true })
    expect(readPreference('autoRunOnBoot')).toBe(false)
    expect(readPreference('runnerControlsVisible')).toBe(true)
  })

  it('pins the shipped defaults when the store holds nothing', () => {
    seedPreferences({ autoRunOnBoot: null, runnerControlsVisible: null })
    expect(readPreference('autoRunOnBoot')).toBe(true)
    expect(readPreference('runnerControlsVisible')).toBe(false)
  })

  it('never overwrites a choice the user already made', () => {
    writePreference('autoRunOnBoot', false)
    seedPreferences({ autoRunOnBoot: true, runnerControlsVisible: null })
    expect(readPreference('autoRunOnBoot')).toBe(false)
  })
})
