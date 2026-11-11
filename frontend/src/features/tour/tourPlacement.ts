export interface Rect {
  x: number
  y: number
  w: number
  h: number
}
export interface Size {
  w: number
  h: number
}
export type Side = 'right' | 'left' | 'below' | 'above'

export interface Placement {
  // The side of the element the box sits on; the arrow is on the box's opposite edge, pointing back at it.
  side: Side
  // The box's top-left corner in frame pixels.
  x: number
  y: number
  // Where along the arrow's edge it sits, in pixels from the box's top (right/left) or left (below/above).
  arrow: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// Where the callout box goes beside an element (fractions of the frame) inside a frame of `frame` pixels: the first
// side with room for the whole box, clamped into the frame, never over the element. Null when no side fits.
export function placeCallout(
  rect: Rect,
  box: Size,
  frame: Size,
  gap = 18,
  margin = 12,
  arrowInset = 22,
): Placement | null {
  const left = rect.x * frame.w
  const top = rect.y * frame.h
  const right = left + rect.w * frame.w
  const bottom = top + rect.h * frame.h
  const midX = (left + right) / 2
  const midY = (top + bottom) / 2
  const maxX = frame.w - margin - box.w
  const maxY = frame.h - margin - box.h
  if (maxX < margin || maxY < margin) return null
  // The arrow aims at the element's middle, kept off the box's rounded corners.
  const aim = (target: number, start: number, length: number) =>
    clamp(target - start, arrowInset, length - arrowInset)

  const candidates: Record<Side, () => Placement | null> = {
    right: () => {
      const x = right + gap
      if (x > maxX) return null
      const y = clamp(midY - box.h / 2, margin, maxY)
      return { side: 'right', x, y, arrow: aim(midY, y, box.h) }
    },
    left: () => {
      const x = left - gap - box.w
      if (x < margin) return null
      const y = clamp(midY - box.h / 2, margin, maxY)
      return { side: 'left', x, y, arrow: aim(midY, y, box.h) }
    },
    below: () => {
      const y = bottom + gap
      if (y > maxY) return null
      const x = clamp(midX - box.w / 2, margin, maxX)
      return { side: 'below', x, y, arrow: aim(midX, x, box.w) }
    },
    above: () => {
      const y = top - gap - box.h
      if (y < margin) return null
      const x = clamp(midX - box.w / 2, margin, maxX)
      return { side: 'above', x, y, arrow: aim(midX, x, box.w) }
    },
  }
  for (const side of ['right', 'left', 'below', 'above'] as const) {
    const placed = candidates[side]()
    if (placed) return placed
  }
  return null
}
