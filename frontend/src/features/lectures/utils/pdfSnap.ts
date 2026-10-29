// Device-pixel sizing for the PDF preview: a canvas stays sharp only when shown 1:1 with its buffer on a device-pixel line.

const EPS = 1e-6

// Largest whole-device-pixel width that fits `contentW` css px, and the css width of the Page to request for it.
// The page width carries +0.05 device px so react-pdf's truncating `width * dpr` can't land one pixel short.
export function snapWidth(contentW: number, dpr: number): { devW: number; pageWidth: number } {
  const devW = Math.max(1, Math.floor(contentW * dpr + EPS))
  return { devW, pageWidth: (devW + 0.05) / dpr }
}

// Transform putting a buffer-sized canvas 1:1 on the device grid. Chrome places the layer at the scroller's device-snapped
// origin plus a whole-css-px offset, so the remainder is measured from there; pos is in scroll-0 coordinates.
export function snapTransform(
  left: number,
  top: number,
  dpr: number,
  scrollerLeft = 0,
  scrollerTop = 0,
): string {
  const shift = (pos: number, parent: number) => {
    const dev = Math.round(parent * dpr) + (Math.round(pos) - Math.round(parent)) * dpr
    return (Math.round(dev) - dev) / dpr
  }
  return `translate(${shift(left, scrollerLeft)}px, ${shift(top, scrollerTop)}px) scale(${1 / dpr})`
}
