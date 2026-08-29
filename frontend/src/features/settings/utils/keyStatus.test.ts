import { describe, it, expect } from 'vitest'
import { prefixStatus, shouldProbe } from './keyStatus'

describe('prefixStatus', () => {
  it('warns when the value does not start with the provider prefix', () => {
    expect(prefixStatus('gsk_abc', 'AIza')).toEqual({ kind: 'prefix' })
  })

  it('stays quiet on a matching prefix and on an empty field', () => {
    expect(prefixStatus('AIzaabc', 'AIza')).toBeNull()
    expect(prefixStatus('   ', 'AIza')).toBeNull()
  })

  it('stays quiet when the provider declares no prefix', () => {
    expect(prefixStatus('anything', '')).toBeNull()
  })
})

describe('shouldProbe', () => {
  it('probes a new non-empty value', () => {
    expect(shouldProbe('gsk_abc', null)).toBe(true)
    expect(shouldProbe('gsk_abc', 'gsk_old')).toBe(true)
  })

  it('does not re-probe an unchanged value, so cycling focus is free', () => {
    expect(shouldProbe('gsk_abc', 'gsk_abc')).toBe(false)
    expect(shouldProbe('  gsk_abc  ', 'gsk_abc')).toBe(false)
  })

  it('never probes an empty field', () => {
    expect(shouldProbe('', null)).toBe(false)
    expect(shouldProbe('   ', 'gsk_abc')).toBe(false)
  })
})
