import { describe, it, expect } from 'vitest'
import { resolvePreference } from './uiPreferences'

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
