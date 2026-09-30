import { describe, it, expect } from 'vitest'
import { inFlightKey, parseInFlightKey } from './inFlightKey'

describe('parseInFlightKey', () => {
  it('recovers the course, lecture and kind a key was built from', () => {
    const key = inFlightKey('hb-edit', 'שיעור 1', 'recitation')
    expect(parseInFlightKey(key)).toEqual({
      course: 'hb-edit',
      lecture: 'שיעור 1',
      kind: 'recitation',
    })
  })

  it("rejects a key that names no lecture, like the runner's crash", () => {
    expect(parseInFlightKey('runner-crash')).toBeNull()
    expect(parseInFlightKey('a||b||other')).toBeNull()
  })
})
