import { describe, it, expect } from 'vitest'
import { moveModel, removeModel, sameList } from './geminiOrder'

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
