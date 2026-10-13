import { describe, expect, it } from 'vitest'
import { defaultTab } from './downloadsTab'

describe('defaultTab', () => {
  it('keeps a valid stored choice whatever the account says', () => {
    for (const connected of [true, false, undefined]) {
      expect(defaultTab('manual', connected)).toBe('manual')
      expect(defaultTab('extension', connected)).toBe('extension')
      expect(defaultTab('university', connected)).toBe('university')
    }
  })

  it('treats a stale stored value like a missing one', () => {
    expect(defaultTab('recordings', true)).toBe('university')
    expect(defaultTab('recordings', false)).toBe('extension')
    expect(defaultTab('recordings', undefined)).toBeNull()
  })

  it('opens University when signed in and Extension when not', () => {
    expect(defaultTab(null, true)).toBe('university')
    expect(defaultTab(null, false)).toBe('extension')
  })

  it('stays undecided while the account is unknown', () => {
    expect(defaultTab(null, undefined)).toBeNull()
  })
})
