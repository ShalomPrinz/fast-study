// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { readPreference, resolvePreference, writePreference } from './uiPreferences'

beforeEach(() => {
  localStorage.clear()
})

describe('resolvePreference', () => {
  it('lets a stored choice outrank the shipped default', () => {
    expect(resolvePreference('false', true)).toBe(false)
    expect(resolvePreference('true', false)).toBe(true)
  })

  it('falls back to the shipped default when the profile has never answered', () => {
    expect(resolvePreference(null, true)).toBe(true)
    expect(resolvePreference(null, false)).toBe(false)
  })

  it('treats an unrecognised stored value as no answer', () => {
    expect(resolvePreference('yes', false)).toBe(false)
  })
})

describe('the shipped default', () => {
  it('hides the runner controls', () => {
    expect(readPreference('runnerControlsVisible')).toBe(false)
  })
})

describe('writePreference', () => {
  it('keeps the choice in localStorage, where nothing but this profile can reach it', () => {
    writePreference('runnerControlsVisible', true)

    expect(localStorage.getItem('fast-study:runner-controls-visible')).toBe('true')
    expect(readPreference('runnerControlsVisible')).toBe(true)
  })
})
