import { describe, expect, it } from 'vitest'
import type { Settings } from '@/services/settings'
import { autoRetryFromStore, autoRetryPatch, parseRetryInt } from './autoRetry'

const unset = {
  autoRetry: null,
  autoRetryCount: null,
  autoRetryMinutes: null,
} as unknown as Settings

describe('auto retry form', () => {
  it('reads unset as on, 3, 10', () => {
    expect(autoRetryFromStore(unset)).toEqual({ on: true, count: 3, minutes: 10 })
  })

  it('sends nothing while the form matches the defaults of an unset store', () => {
    expect(autoRetryPatch({ on: true, count: 3, minutes: 10 }, unset)).toEqual({})
  })

  it('sends real bools and integers, only for what changed', () => {
    expect(autoRetryPatch({ on: false, count: 5, minutes: 10 }, unset)).toEqual({
      autoRetry: false,
      autoRetryCount: 5,
    })
  })
})

describe('parseRetryInt', () => {
  const range = { min: 1, max: 10 }
  it('takes whole numbers in range', () => {
    expect(parseRetryInt('4', range)).toBe(4)
    expect(parseRetryInt('10', range)).toBe(10)
  })
  it('clamps out of range numbers to the nearest bound', () => {
    expect(parseRetryInt('11', range)).toBe(10)
    expect(parseRetryInt('0', range)).toBe(1)
    expect(parseRetryInt('99999999999999999999', range)).toBe(10)
  })
  it('refuses empty, fractional, signed and non-numeric text', () => {
    for (const text of ['', '2.5', '-1', 'x']) expect(parseRetryInt(text, range)).toBeNull()
  })
})
