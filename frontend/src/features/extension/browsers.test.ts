import { describe, expect, it } from 'vitest'
import { extensionsUrl, shotKey } from './browsers'

describe('browsers', () => {
  it('points each browser at its own extensions page', () => {
    expect(extensionsUrl('chrome')).toBe('chrome://extensions')
    expect(extensionsUrl('edge')).toBe('edge://extensions')
  })

  it('keeps each browser screenshots in its own folder', () => {
    expect(shotKey('chrome', '4-pin')).toBe('chrome/4-pin.png')
    expect(shotKey('edge', '4-pin')).toBe('edge/4-pin.png')
  })
})
