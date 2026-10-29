import { describe, expect, it } from 'vitest'
import { formatCountdown, secondsUntil } from './retry'

const AT = '2026-10-29T12:10:00Z'
const at = Date.parse(AT)

describe('secondsUntil', () => {
  it('rounds a partial second up so the line never reads 0:00 early', () => {
    expect(secondsUntil(AT, at - 599_500)).toBe(600)
    expect(secondsUntil(AT, at - 1)).toBe(1)
  })
  it('floors at zero once due or when the stamp is unreadable', () => {
    expect(secondsUntil(AT, at + 5000)).toBe(0)
    expect(secondsUntil('nope', at)).toBe(0)
  })
})

describe('formatCountdown', () => {
  it('reads m:ss', () => {
    expect(formatCountdown(600)).toBe('10:00')
    expect(formatCountdown(65)).toBe('1:05')
    expect(formatCountdown(0)).toBe('0:00')
    expect(formatCountdown(-3)).toBe('0:00')
  })
})
