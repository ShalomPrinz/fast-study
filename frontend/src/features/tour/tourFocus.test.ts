import { describe, expect, it } from 'vitest'
import { rememberFocus, tabTarget } from './tourFocus'

describe('tabTarget', () => {
  const items = ['a', 'b', 'c']
  it('wraps forward from the last and backward from the first', () => {
    expect(tabTarget(items, 'c', false)).toBe('a')
    expect(tabTarget(items, 'a', true)).toBe('c')
  })
  it('leaves a move inside the dialog to the browser', () => {
    expect(tabTarget(items, 'a', false)).toBeNull()
    expect(tabTarget(items, 'c', true)).toBeNull()
  })
  it('pulls focus in from outside', () => {
    expect(tabTarget(items, 'x', false)).toBe('a')
    expect(tabTarget(items, null, true)).toBe('c')
  })
})

describe('rememberFocus', () => {
  it('puts focus back on the element that had it', () => {
    let focused = 0
    const el = { isConnected: true, focus: () => focused++ }
    rememberFocus({ activeElement: el })()
    expect(focused).toBe(1)
  })
  it('does nothing when that element left the page', () => {
    let focused = 0
    const el = { isConnected: false, focus: () => focused++ }
    rememberFocus({ activeElement: el })()
    expect(focused).toBe(0)
  })
})
