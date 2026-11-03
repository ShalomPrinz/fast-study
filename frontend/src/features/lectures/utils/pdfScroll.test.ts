import { describe, it, expect } from 'vitest'
import { shouldCaptureScroll, afterPageRender, scaleScroll, zoomScrollState } from './pdfScroll'

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

describe('afterPageRender', () => {
  it('restores while pages are pending, then stops', () => {
    expect(afterPageRender(2)).toEqual({ restore: true, pending: 1 })
    expect(afterPageRender(1)).toEqual({ restore: true, pending: 0 })
    expect(afterPageRender(0)).toEqual({ restore: false, pending: 0 })
  })

  it('never stops on its own while the page count is still unknown', () => {
    expect(afterPageRender(Infinity).restore).toBe(true)
  })
})

describe('scaleScroll', () => {
  it('scales both offsets by the zoom ratio', () => {
    expect(scaleScroll({ top: 1000, left: 40 }, 1.5)).toEqual({ top: 1500, left: 60 })
  })
})

describe('zoomScrollState', () => {
  const zero = { top: 0, left: 0 }

  it('scales the live offsets when nothing is pending', () => {
    const r = zoomScrollState({
      pending: 0,
      captured: zero,
      live: { top: 1000, left: 0 },
      ratio: 1.5,
      numPages: 4,
    })
    expect(r).toEqual({ captured: { top: 1500, left: 0 }, pending: 4 })
  })

  it('compounds a second zoom on the captured position, not the pre-render live one', () => {
    const first = zoomScrollState({
      pending: 0,
      captured: zero,
      live: { top: 1000, left: 0 },
      ratio: 1.4 / 1.2,
      numPages: 4,
    })
    const second = zoomScrollState({
      pending: first.pending,
      captured: first.captured,
      live: { top: 1000, left: 0 },
      ratio: 1.6 / 1.4,
      numPages: 4,
    })
    expect(second.captured.top).toBeCloseTo((1000 * 1.6) / 1.2)
    expect(second.pending).toBe(4)
  })

  it('keeps the url-change capture and Infinity pending while the document loads', () => {
    const r = zoomScrollState({
      pending: Infinity,
      captured: { top: 800, left: 10 },
      live: zero,
      ratio: 2,
      numPages: 7,
    })
    expect(r).toEqual({ captured: { top: 1600, left: 20 }, pending: Infinity })
  })
})
