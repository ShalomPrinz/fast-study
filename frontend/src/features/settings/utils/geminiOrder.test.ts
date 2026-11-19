import { describe, it, expect } from 'vitest'
import { arrowsShown, moveModel, removeModel, sameList } from './geminiOrder'

describe('moveModel', () => {
  it('swaps a row with its neighbour and stays put at the ends', () => {
    expect(moveModel(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c'])
    expect(moveModel(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b'])
    expect(moveModel(['a', 'b'], 0, -1)).toEqual(['a', 'b'])
    expect(moveModel(['a', 'b'], 1, 1)).toEqual(['a', 'b'])
  })
})

describe('removeModel', () => {
  it('removes one row but refuses to empty the list', () => {
    expect(removeModel(['a', 'b'], 'a')).toEqual(['b'])
    expect(removeModel(['a'], 'a')).toBeNull()
  })
})

describe('sameList', () => {
  it('compares order too', () => {
    expect(sameList(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(sameList(['a', 'b'], ['b', 'a'])).toBe(false)
  })
})

describe('arrowsShown', () => {
  it('hides the up arrow on the top row and the down arrow on the bottom row', () => {
    expect(arrowsShown(0, 3)).toEqual({ up: false, down: true })
    expect(arrowsShown(1, 3)).toEqual({ up: true, down: true })
    expect(arrowsShown(2, 3)).toEqual({ up: true, down: false })
    expect(arrowsShown(0, 1)).toEqual({ up: false, down: false })
  })
})
