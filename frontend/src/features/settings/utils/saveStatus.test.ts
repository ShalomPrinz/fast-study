import { describe, expect, it } from 'vitest'
import { saveState } from './saveStatus'

describe('saveState', () => {
  it('shows saving while a save is in flight, even after an earlier one landed', () => {
    expect(saveState(true, 0)).toBe('saving')
    expect(saveState(true, 3)).toBe('saving')
  })
  it('shows saved once a save landed and none is in flight', () => {
    expect(saveState(false, 1)).toBe('saved')
  })
  it('shows nothing otherwise', () => {
    expect(saveState(false, 0)).toBe('idle')
  })
})
