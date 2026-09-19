import { describe, it, expect, beforeEach } from 'vitest'
import {
  clearSectionCollapse,
  expandSection,
  isSectionOpen,
  toggleSection,
} from './SectionCollapseContext'

describe('the section collapse store', () => {
  beforeEach(() => clearSectionCollapse())

  it('reads every section as open by default', () => {
    expect(isSectionOpen('a')).toBe(true)
  })

  it('toggles only the named section', () => {
    toggleSection('a')
    expect(isSectionOpen('a')).toBe(false)
    expect(isSectionOpen('b')).toBe(true)
    toggleSection('a')
    expect(isSectionOpen('a')).toBe(true)
  })

  it('opens a collapsed section on expand, and leaves an open one open', () => {
    toggleSection('a')
    expandSection('a')
    expandSection('b')
    expect(isSectionOpen('a')).toBe(true)
    expect(isSectionOpen('b')).toBe(true)
  })

  it('reopens every section on clear', () => {
    toggleSection('a')
    toggleSection('b')
    clearSectionCollapse()
    expect(isSectionOpen('a')).toBe(true)
    expect(isSectionOpen('b')).toBe(true)
  })
})
