import { describe, expect, it } from 'vitest'
import { foundAfterLookup, tourMode, tourReducer, type Found, type TourState } from './tourMachine'

const TOTAL = 3
const run = (s: TourState, ...a: Parameters<typeof tourReducer>[1][]) =>
  a.reduce((acc, x) => tourReducer(acc, x, TOTAL), s)
const idle: TourState = { active: false, index: 0 }

describe('tourReducer', () => {
  it('starts at the first step, whatever the state was', () => {
    expect(run({ active: true, index: 2 }, { type: 'start' })).toEqual({ active: true, index: 0 })
  })
  it('walks forward and back, and Back stops at the first step', () => {
    const s = run(idle, { type: 'start' }, { type: 'next' }, { type: 'next' })
    expect(s.index).toBe(2)
    expect(run(s, { type: 'back' }).index).toBe(1)
    expect(run(idle, { type: 'start' }, { type: 'back' }).index).toBe(0)
  })
  it('finishes on Next past the last step', () => {
    expect(
      run(idle, { type: 'start' }, { type: 'next' }, { type: 'next' }, { type: 'next' }),
    ).toEqual(idle)
  })
  it('ends on Skip at any step', () => {
    expect(run(idle, { type: 'start' }, { type: 'next' }, { type: 'skip' })).toEqual(idle)
  })
  it('ignores next and back while inactive', () => {
    expect(run(idle, { type: 'next' }, { type: 'back' })).toEqual(idle)
  })
})

describe('tourMode', () => {
  it('spotlights a found anchor, even before the page settled', () => {
    expect(tourMode(true, false)).toBe('spotlight')
    expect(tourMode(true, true)).toBe('spotlight')
  })
  it('waits for a missing anchor, then falls back to the card', () => {
    expect(tourMode(false, false)).toBe('pending')
    expect(tourMode(false, true)).toBe('card')
  })
})

describe('foundAfterLookup', () => {
  const none: Found<string> = { el: null, settled: false }
  it('settles on the first sighting and spotlights it', () => {
    const f = foundAfterLookup(none, 'a')
    expect(f).toEqual({ el: 'a', settled: true })
    expect(tourMode(!!f.el, f.settled)).toBe('spotlight')
  })
  it('falls to the card the moment a seen anchor leaves, and back when it returns', () => {
    const seen = foundAfterLookup(none, 'a')
    const gone = foundAfterLookup(seen, null)
    expect(tourMode(!!gone.el, gone.settled)).toBe('card')
    expect(foundAfterLookup(gone, 'b').el).toBe('b')
  })
  it('keeps waiting while nothing has been seen', () => {
    expect(foundAfterLookup(none, null)).toBe(none)
  })
})
