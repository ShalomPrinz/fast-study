import { afterEach, describe, expect, it, vi } from 'vitest'
import { markTourSeen, isTourSeen, TOUR_STORAGE_KEY } from './tourFlag'

function stubStorage(store: Record<string, string>) {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => void (store[k] = v),
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('tour seen flag', () => {
  it('is unseen until marked, then stays seen', () => {
    stubStorage({})
    expect(isTourSeen()).toBe(false)
    markTourSeen()
    expect(isTourSeen()).toBe(true)
  })
  it('treats any other stored value as unseen', () => {
    stubStorage({ [TOUR_STORAGE_KEY]: 'yes' })
    expect(isTourSeen()).toBe(false)
  })
  it('shows the tour and swallows the write when storage throws', () => {
    const boom = () => {
      throw new Error('blocked')
    }
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom })
    expect(isTourSeen()).toBe(false)
    expect(() => markTourSeen()).not.toThrow()
  })
})
