import { describe, it, expect } from 'vitest'
import { readSource, storedSource, writeSource } from './manualSource'

describe('the remembered source', () => {
  it('is Link unless File was stored', () => {
    expect(storedSource('file')).toBe('file')
    expect(storedSource('link')).toBe('link')
    expect(storedSource(null)).toBe('link')
    expect(storedSource('x')).toBe('link')
  })

  it('survives blocked storage', () => {
    expect(readSource()).toBe('link')
    expect(() => writeSource('file')).not.toThrow()
  })
})
