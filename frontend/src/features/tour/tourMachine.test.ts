import { describe, expect, it } from 'vitest'
import { arrowDelta, moveSlide } from './tourMachine'

describe('moveSlide', () => {
  it('moves by the delta and stops at both ends', () => {
    expect(moveSlide(0, 1, 7)).toBe(1)
    expect(moveSlide(6, 1, 7)).toBe(6)
    expect(moveSlide(0, -1, 7)).toBe(0)
    expect(moveSlide(6, -1, 7)).toBe(5)
  })
})

describe('arrowDelta', () => {
  it('advances on the right arrow in LTR and the left arrow in RTL', () => {
    expect(arrowDelta('ArrowRight', false)).toBe(1)
    expect(arrowDelta('ArrowLeft', false)).toBe(-1)
    expect(arrowDelta('ArrowLeft', true)).toBe(1)
    expect(arrowDelta('ArrowRight', true)).toBe(-1)
  })
  it('ignores every other key', () => {
    expect(arrowDelta('ArrowUp', false)).toBeNull()
    expect(arrowDelta('Enter', true)).toBeNull()
  })
})
