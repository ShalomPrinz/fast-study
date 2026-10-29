import { describe, it, expect } from 'vitest'
import { storedScope } from './scope'

describe('storedScope', () => {
  it('defaults to New when nothing usable is stored', () => {
    expect(storedScope(null)).toBe('new')
    expect(storedScope('garbage')).toBe('new')
  })

  it('keeps an explicit All', () => {
    expect(storedScope('all')).toBe('all')
    expect(storedScope('new')).toBe('new')
  })
})
