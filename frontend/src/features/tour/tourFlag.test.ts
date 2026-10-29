import { afterEach, describe, expect, it, vi } from 'vitest'
import { dismissTour, isTourDismissed, TOUR_STORAGE_KEY } from './tourFlag'

function stubStorage(store: Record<string, string>) {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => void (store[k] = v),
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('tour dismissal flag', () => {
  it('shows the tour until dismissed, then stays dismissed', () => {
    stubStorage({})
    expect(isTourDismissed()).toBe(false)
    dismissTour()
    expect(isTourDismissed()).toBe(true)
  })
  it('treats any other stored value as not dismissed', () => {
    stubStorage({ [TOUR_STORAGE_KEY]: 'yes' })
    expect(isTourDismissed()).toBe(false)
  })
  it('shows the tour and swallows the write when storage throws', () => {
    const boom = () => {
      throw new Error('blocked')
    }
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom })
    expect(isTourDismissed()).toBe(false)
    expect(() => dismissTour()).not.toThrow()
  })
})
