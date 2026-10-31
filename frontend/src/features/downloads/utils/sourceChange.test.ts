import { describe, expect, it } from 'vitest'
import { sourceChangeAction } from './sourceChange'

describe('sourceChangeAction', () => {
  it('reloads the loaded course from its new URL', () => {
    expect(sourceChangeAction(true, false, 'https://a', 'https://b')).toBe('reload')
  })

  it('reloads a course whose load is in flight', () => {
    expect(sourceChangeAction(false, true, 'https://a', 'https://b')).toBe('reload')
  })

  it('closes the panel when the loaded course loses its URL', () => {
    expect(sourceChangeAction(true, false, 'https://a', '')).toBe('close')
    expect(sourceChangeAction(false, true, 'https://a', '')).toBe('close')
  })

  it('loads a picked course that was neither loaded nor loading, including one with no source', () => {
    expect(sourceChangeAction(false, false, 'https://a', 'https://b')).toBe('reload')
    expect(sourceChangeAction(false, false, '', 'https://b')).toBe('reload')
  })

  it('leaves a course neither loaded nor loading alone when its URL is cleared', () => {
    expect(sourceChangeAction(false, false, 'https://a', '')).toBe('none')
  })

  it('does nothing for an unchanged URL', () => {
    expect(sourceChangeAction(true, false, 'https://a', 'https://a')).toBe('none')
  })
})
