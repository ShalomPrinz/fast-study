import { describe, it, expect } from 'vitest'
import { shouldCaptureScroll } from './pdfScroll'

describe('shouldCaptureScroll', () => {
  it('captures when a generate starts, before the spinner unmounts the pages', () => {
    expect(
      shouldCaptureScroll({ url: 'a', generating: false }, { url: 'a', generating: true }),
    ).toBe(true)
  })

  it('captures when the url changes with the pages mounted', () => {
    expect(
      shouldCaptureScroll({ url: 'a', generating: false }, { url: 'b', generating: false }),
    ).toBe(true)
  })

  it('does not capture on a plain re-render or when a generate ends', () => {
    expect(
      shouldCaptureScroll({ url: 'a', generating: false }, { url: 'a', generating: false }),
    ).toBe(false)
    expect(
      shouldCaptureScroll({ url: 'b', generating: true }, { url: 'b', generating: false }),
    ).toBe(false)
  })
})
