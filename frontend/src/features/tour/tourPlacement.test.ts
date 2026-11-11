import { describe, expect, it } from 'vitest'
import { placeCallout, type Rect, type Size } from './tourPlacement'

const frame: Size = { w: 900, h: 560 }
const box: Size = { w: 260, h: 150 }
const overlaps = (p: { x: number; y: number }, r: Rect) =>
  p.x < (r.x + r.w) * frame.w &&
  p.x + box.w > r.x * frame.w &&
  p.y < (r.y + r.h) * frame.h &&
  p.y + box.h > r.y * frame.h

describe('placeCallout', () => {
  it('puts the box beside a small element, vertically centred, with the arrow on its middle', () => {
    const r = { x: 0.1, y: 0.4, w: 0.1, h: 0.05 }
    const p = placeCallout(r, box, frame)!
    expect(p.side).toBe('right')
    expect(p.x).toBeGreaterThan((r.x + r.w) * frame.w)
    expect(p.y + p.arrow).toBeCloseTo((r.y + r.h / 2) * frame.h)
  })

  it('goes below a wide element that leaves no room at its sides', () => {
    const r = { x: 0.03, y: 0.12, w: 0.94, h: 0.05 }
    expect(placeCallout(r, box, frame)!.side).toBe('below')
  })

  it('goes above when only the top has room, and left when the right edge is hit', () => {
    expect(placeCallout({ x: 0.03, y: 0.85, w: 0.94, h: 0.1 }, box, frame)!.side).toBe('above')
    expect(placeCallout({ x: 0.8, y: 0.4, w: 0.1, h: 0.1 }, box, frame)!.side).toBe('left')
  })

  it('clamps into the frame and never covers the element', () => {
    for (const r of [
      { x: 0, y: 0, w: 0.2, h: 0.04 },
      { x: 0.8, y: 0.96, w: 0.2, h: 0.04 },
      { x: 0.65, y: 0.13, w: 0.19, h: 0.8 },
    ]) {
      const p = placeCallout(r, box, frame)!
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.x + box.w).toBeLessThanOrEqual(frame.w)
      expect(p.y + box.h).toBeLessThanOrEqual(frame.h)
      expect(overlaps(p, r)).toBe(false)
    }
  })

  it('keeps the arrow off the box corners', () => {
    const p = placeCallout({ x: 0.1, y: 0, w: 0.1, h: 0.02 }, box, frame)!
    expect(p.arrow).toBeGreaterThanOrEqual(22)
  })

  it('gives up when the frame is too small for the box', () => {
    expect(placeCallout({ x: 0.4, y: 0.4, w: 0.1, h: 0.1 }, box, { w: 300, h: 200 })).toBeNull()
  })
})
