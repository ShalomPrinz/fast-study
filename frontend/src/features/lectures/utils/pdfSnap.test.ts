import { describe, it, expect } from 'vitest'
import { cropFromText, snapTransform, snapWidth } from './pdfSnap'

describe('snapWidth', () => {
  it('keeps an integer width at DPR 1 exactly', () => {
    expect(snapWidth(341, 1).devW).toBe(341)
  })

  it('floors the fractional content box to whole device pixels', () => {
    expect(snapWidth(340.6667, 1.5).devW).toBe(511)
    expect(snapWidth(341, 1.25).devW).toBe(426)
  })

  it('requests a page width whose scaled buffer truncates to devW', () => {
    for (const [w, d] of [
      [340.6667, 1.5],
      [1399.3, 1.25],
      [341, 1],
      [777.77, 1.75],
    ]) {
      const { devW, pageWidth } = snapWidth(w, d)
      expect(Math.trunc(pageWidth * d)).toBe(devW)
    }
  })
})

const shifts = (t: string) =>
  [...t.matchAll(/translate\((-?[\d.e-]+)px, (-?[\d.e-]+)px\)/g)][0].slice(1).map(Number)

describe('snapTransform', () => {
  it('puts the css-snapped origin on a device pixel', () => {
    for (const [left, top, d] of [
      [362.1667, 100.4, 1.5],
      [577.3, 369.5, 1.25],
      [865.984375, 554.015625, 1.75],
    ]) {
      const [x, y] = shifts(snapTransform(left, top, d))
      expect((Math.round(left) + x) * d).toBeCloseTo(Math.round((Math.round(left) + x) * d), 6)
      expect((Math.round(top) + y) * d).toBeCloseTo(Math.round((Math.round(top) + y) * d), 6)
    }
  })

  it('measures the remainder from the scroller origin, as Chrome lays the layer out', () => {
    // Scroller at y 172.5 (device 259): a page at 369.5 sits at 259 + 197 * 1.5 = 554.5, half a device px off.
    const [, y] = shifts(snapTransform(577, 369.5, 1.5, 536, 172.5))
    expect(y).toBeCloseTo(1 / 3, 6)
    // The same page 1 css px lower lands on the grid.
    expect(shifts(snapTransform(577, 370.5, 1.5, 536, 172.5))[1]).toBeCloseTo(0, 6)
  })

  it('adds no shift at DPR 1', () => {
    expect(shifts(snapTransform(577.5, 369.5, 1)).map(Math.abs)).toEqual([0, 0])
  })

  it('scales by 1/dpr so the buffer shows 1:1', () => {
    expect(snapTransform(0, 0, 1.25)).toContain('scale(0.8)')
  })

  it('adds the crop offset after the grid correction', () => {
    expect(snapTransform(0, 0, 1, 0, 0, -40, -10)).toContain('translate(-40px, -10px)')
  })
})

describe('cropFromText', () => {
  const view: [number, number, number, number] = [0, 0, 600, 800]
  it('crops to the text block plus a gutter, asymmetric margins included', () => {
    const c = cropFromText(
      [
        { x: 100, y: 700, w: 400, h: 10 },
        { x: 120, y: 300, w: 360, h: 10 },
      ],
      view,
      0.05,
    )!
    expect(c.x0).toBeCloseTo((100 - 20) / 600, 6)
    expect(c.x1).toBeCloseTo((500 + 20) / 600, 6)
    expect(c.y0).toBeCloseTo((800 - 710 - 20) / 800, 6)
  })

  it('clamps the gutter to the page', () => {
    const c = cropFromText([{ x: 5, y: 795, w: 400, h: 10 }], view)!
    expect(c.x0).toBe(0)
    expect(c.y0).toBe(0)
  })

  it('returns null without text or when the crop is not worth it', () => {
    expect(cropFromText([], view)).toBeNull()
    expect(cropFromText([{ x: 0, y: 10, w: 0, h: 10 }], view)).toBeNull()
    expect(cropFromText([{ x: 10, y: 10, w: 585, h: 10 }], view)).toBeNull()
  })

  it('widens a narrow block to the minimum, centred and inside the page', () => {
    const mid = cropFromText([{ x: 250, y: 400, w: 100, h: 10 }], view, 0)!
    expect(mid.x0).toBeCloseTo(0.2, 6)
    expect(mid.x1).toBeCloseTo(0.8, 6)
    const left = cropFromText([{ x: 0, y: 400, w: 60, h: 10 }], view, 0)!
    expect(left.x0).toBe(0)
    expect(left.x1).toBeCloseTo(0.6, 6)
    const right = cropFromText([{ x: 540, y: 400, w: 60, h: 10 }], view, 0)!
    expect(right.x0).toBeCloseTo(0.4, 6)
    expect(right.x1).toBeCloseTo(1, 6)
  })

  it('measures from a non-zero view origin', () => {
    const c = cropFromText([{ x: 110, y: 700, w: 400, h: 10 }], [10, 20, 610, 820], 0)!
    expect(c.x0).toBeCloseTo(100 / 600, 6)
    expect(c.x1).toBeCloseTo(500 / 600, 6)
    expect(c.y0).toBeCloseTo((820 - 710) / 800, 6)
  })
})
