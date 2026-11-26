import { describe, it, expect } from 'vitest'
import { isRenameKey } from './renameKey'

describe('isRenameKey', () => {
  it('accepts F2, Enter and Space, with or without Shift', () => {
    expect(isRenameKey({ key: 'F2', shiftKey: false })).toBe(true)
    expect(isRenameKey({ key: 'Enter', shiftKey: false })).toBe(true)
    expect(isRenameKey({ key: 'Enter', shiftKey: true })).toBe(true)
    expect(isRenameKey({ key: ' ', shiftKey: false })).toBe(true)
  })
  it('rejects other keys', () => {
    expect(isRenameKey({ key: 'a', shiftKey: true })).toBe(false)
    expect(isRenameKey({ key: 'Tab', shiftKey: false })).toBe(false)
  })
})
