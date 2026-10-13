import { describe, expect, it } from 'vitest'
import { defaultTab } from './downloadsTab'

describe('defaultTab', () => {
  it('keeps a valid stored choice whatever the account says', () => {
    for (const connected of [true, false, null]) {
      expect(defaultTab('manual', connected)).toBe('manual')
      expect(defaultTab('extension', connected)).toBe('extension')
      expect(defaultTab('university', connected)).toBe('university')
    }
  })

  it('treats a stale stored value like a missing one', () => {
    expect(defaultTab('recordings', true)).toBe('university')
    expect(defaultTab('recordings', false)).toBe('extension')
    expect(defaultTab('recordings', null)).toBeNull()
  })

  it('opens University when signed in, Extension when signed out or the read failed', () => {
    expect(defaultTab(null, true)).toBe('university')
    expect(defaultTab(null, false)).toBe('extension')
  })

  it('stays undecided until the first account answer settles', () => {
    expect(defaultTab(null, null)).toBeNull()
  })
})
