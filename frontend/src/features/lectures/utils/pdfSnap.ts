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

// Fractions of the page (from its top-left) that the preview shows.
export interface Crop {
  x0: number
  x1: number
  y0: number
}

// Centred zoom on the width, with the top cropped by the same absolute length so the top margin equals the side margins.
export function zoomCrop(zoom: number, bufW: number, bufH: number): Crop {
  const x0 = (1 - 1 / zoom) / 2
  return { x0, x1: 1 - x0, y0: bufH > 0 ? (x0 * bufW) / bufH : 0 }
}
