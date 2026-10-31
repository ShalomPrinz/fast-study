import { zoomCrop } from './pdfSnap'

export type HeroPhase = 'failed' | 'loading' | 'ready'

// Failed beats everything; the skeleton stands until the first page render lands.
export function heroPhase(failed: boolean, rendered: boolean): HeroPhase {
  return failed ? 'failed' : rendered ? 'ready' : 'loading'
}

const LETTER_ASPECT = 11 / 8.5

// Height the cropped US Letter page will occupy at `pageWidth`, capped like the thumbnail's max-height.
export function skeletonHeight(pageWidth: number, zoom: number, cap: number | null): number {
  if (pageWidth <= 0) return 0
  const full = pageWidth * LETTER_ASPECT
  const natural = full - zoomCrop(zoom, pageWidth, full).y0 * full
  return Math.round(cap ? Math.min(natural, cap) : natural)
}
