// Device-pixel sizing for the PDF preview: a canvas stays sharp only when shown 1:1 with its buffer on a device-pixel line.

const EPS = 1e-6

// Largest whole-device-pixel width that fits `contentW` css px, and the css width of the Page to request for it.
// The page width carries +0.05 device px so react-pdf's truncating `width * dpr` can't land one pixel short.
export function snapWidth(contentW: number, dpr: number): { devW: number; pageWidth: number } {
  const devW = Math.max(1, Math.floor(contentW * dpr + EPS))
  return { devW, pageWidth: (devW + 0.05) / dpr }
}

// Transform putting a buffer-sized canvas 1:1 on the device grid; offsets must be whole device px / dpr to keep it there. Chrome places the layer at the scroller's device-snapped
// origin plus a whole-css-px offset, so the remainder is measured from there; pos is in scroll-0 coordinates.
export function snapTransform(
  left: number,
  top: number,
  dpr: number,
  scrollerLeft = 0,
  scrollerTop = 0,
  offsetX = 0,
  offsetY = 0,
): string {
  const shift = (pos: number, parent: number) => {
    const dev = Math.round(parent * dpr) + (Math.round(pos) - Math.round(parent)) * dpr
    return (Math.round(dev) - dev) / dpr
  }
  return `translate(${shift(left, scrollerLeft) + offsetX}px, ${shift(top, scrollerTop) + offsetY}px) scale(${1 / dpr})`
}

// A text run in PDF user units: x/y is its baseline start, y grows upward.
export interface TextBox {
  x: number
  y: number
  w: number
  h: number
}

// Fractions of the page (from its top-left) that the preview shows: the text block plus a gutter.
export interface Crop {
  x0: number
  x1: number
  y0: number
}

const MIN_CROP_W = 0.6
const MAX_CROP_W = 0.97

// The text block's bounds as page fractions, widened by `gutter` (a share of the block's width, same unit on the top edge).
// A block narrower than MIN_CROP_W is widened to it, centred and kept inside the page, which caps the zoom. Null when there is no text or the crop would barely change the page.
export function cropFromText(
  boxes: TextBox[],
  view: [number, number, number, number],
  gutter = 0.07,
): Crop | null {
  const [vx0, vy0, vx1, vy1] = view
  const pw = vx1 - vx0
  const ph = vy1 - vy0
  if (!(pw > 0) || !(ph > 0)) return null
  const real = boxes.filter(
    (b) => b.w > 0 && b.h > 0 && [b.x, b.y, b.w, b.h].every(Number.isFinite),
  )
  if (!real.length) return null
  const minX = Math.min(...real.map((b) => b.x))
  const maxX = Math.max(...real.map((b) => b.x + b.w))
  const maxY = Math.max(...real.map((b) => b.y + b.h))
  const pad = (maxX - minX) * gutter
  let x0 = Math.max(0, (minX - pad - vx0) / pw)
  let x1 = Math.min(1, (maxX + pad - vx0) / pw)
  const y0 = Math.max(0, (vy1 - maxY - pad) / ph)
  if (x1 - x0 > MAX_CROP_W) return null
  if (x1 - x0 < MIN_CROP_W) {
    x0 = Math.min(Math.max(0, (x0 + x1) / 2 - MIN_CROP_W / 2), 1 - MIN_CROP_W)
    x1 = x0 + MIN_CROP_W
  }
  return { x0, x1, y0 }
}
