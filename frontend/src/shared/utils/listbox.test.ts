import { describe, expect, it } from 'vitest'
import { nextIndex, typeAheadIndex } from './listbox'

describe('nextIndex', () => {
  it('wraps in both directions', () => {
    expect(nextIndex('ArrowDown', 2, 3)).toBe(0)
    expect(nextIndex('ArrowUp', 0, 3)).toBe(2)
    expect(nextIndex('ArrowDown', 0, 3)).toBe(1)
    expect(nextIndex('ArrowUp', 2, 3)).toBe(1)
  })

  it('sends ArrowUp from nothing active to the last row', () => {
    expect(nextIndex('ArrowUp', -1, 4)).toBe(3)
    expect(nextIndex('ArrowDown', -1, 4)).toBe(0)
  })

  it('jumps with Home and End', () => {
    expect(nextIndex('Home', 2, 5)).toBe(0)
    expect(nextIndex('End', 2, 5)).toBe(4)
  })

  it('ignores other keys and empty lists', () => {
    expect(nextIndex('a', 0, 3)).toBeNull()
    expect(nextIndex('ArrowDown', -1, 0)).toBeNull()
  })
})

describe('typeAheadIndex', () => {
  const labels = ['Apple', 'avocado', 'Banana', 'Apricot']

  it('cycles a repeated letter through its matches', () => {
    expect(typeAheadIndex('a', labels, -1)).toBe(0)
    expect(typeAheadIndex('a', labels, 0)).toBe(1)
    expect(typeAheadIndex('a', labels, 3)).toBe(0)
  })

  it('matches a multi-letter prefix case-insensitively', () => {
    expect(typeAheadIndex('AP', labels, -1)).toBe(0)
    expect(typeAheadIndex('apr', labels, 0)).toBe(3)
  })

  it('stays on the current row when it is the only match', () => {
    expect(typeAheadIndex('ban', labels, 2)).toBe(2)
  })

  it('keeps a growing prefix on the current row while it still matches', () => {
    expect(typeAheadIndex('ap', labels, 0)).toBe(0)
    expect(typeAheadIndex('apr', labels, 3)).toBe(3)
  })

  it('treats a repeated letter as one so it cycles', () => {
    expect(typeAheadIndex('aa', labels, 0)).toBe(1)
    expect(typeAheadIndex('AAA', labels, 3)).toBe(0)
  })

  it('does not flip between two rows sharing a prefix', () => {
    const he = ['אוניברסיטת בר-אילן', 'אוניברסיטת בן-גוריון']
    expect(typeAheadIndex('א', he, -1)).toBe(0)
    expect(typeAheadIndex('או', he, 0)).toBe(0)
    expect(typeAheadIndex('אוניברסיטת בן', he, 0)).toBe(1)
    expect(typeAheadIndex('אוניברסיטת בן', he, 1)).toBe(1)
  })

  it('returns null with no match, an empty buffer or no options', () => {
    expect(typeAheadIndex('z', labels, 0)).toBeNull()
    expect(typeAheadIndex('', labels, 0)).toBeNull()
    expect(typeAheadIndex('a', [], -1)).toBeNull()
  })
})
