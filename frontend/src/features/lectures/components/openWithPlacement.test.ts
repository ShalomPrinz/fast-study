import { describe, expect, it } from 'vitest'
import { shouldOpenUp } from './openWithPlacement'

describe('shouldOpenUp', () => {
  it('stays below when the list fits', () => {
    expect(shouldOpenUp({ top: 100, bottom: 120 }, 40, 600)).toBe(false)
  })
  it('flips up when it overflows below and there is room above', () => {
    expect(shouldOpenUp({ top: 560, bottom: 580 }, 40, 600)).toBe(true)
  })
  it('stays below when neither side fits and above is tighter', () => {
    expect(shouldOpenUp({ top: 10, bottom: 30 }, 400, 300)).toBe(false)
  })
  it('counts the gap', () => {
    expect(shouldOpenUp({ top: 500, bottom: 520 }, 74, 600)).toBe(false)
    expect(shouldOpenUp({ top: 500, bottom: 520 }, 75, 600)).toBe(true)
  })
})
