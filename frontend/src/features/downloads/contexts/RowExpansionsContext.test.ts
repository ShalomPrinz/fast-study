import { describe, it, expect, beforeEach } from 'vitest'
import type { Item } from '../services/autoDownloader'
import { IDLE_EXPAND, clearExpansions, expansionOf, patchExpansion } from './RowExpansionsContext'

function child(ref: string): Item {
  return { ref, title: ref, kind: 'lecture', media: 'video', expandable: false, section: '' }
}

describe('the row expansions store', () => {
  beforeEach(() => clearExpansions())

  it('returns the shared idle identity for a ref that was never expanded', () => {
    expect(expansionOf('missing')).toBe(IDLE_EXPAND)
  })

  it('merges a patch into the target ref, keeping the fields it does not name', () => {
    patchExpansion('a', { expanding: true })
    patchExpansion('a', { children: [child('a1')], expanded: true, expanding: false })
    expect(expansionOf('a')).toEqual({
      expanded: true,
      children: [child('a1')],
      expanding: false,
      error: null,
    })
  })

  it('leaves every sibling entry object untouched', () => {
    patchExpansion('a', { expanded: true })
    patchExpansion('b', { expanded: true })
    const before = expansionOf('a')
    patchExpansion('b', { expanded: false })
    expect(expansionOf('a')).toBe(before)
  })

  it('empties the store on clear', () => {
    patchExpansion('a', { expanded: true, children: [child('a1')] })
    clearExpansions()
    expect(expansionOf('a')).toBe(IDLE_EXPAND)
  })
})
