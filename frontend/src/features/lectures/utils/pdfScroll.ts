export interface PdfViewState {
  url: string
  generating: boolean
}

// The scroll position is worth capturing on the last render that still shows the old pages: a new url
// replaces them, and a generate starting unmounts them under the spinner before the new url arrives.
export function shouldCaptureScroll(prev: PdfViewState, next: PdfViewState): boolean {
  return prev.url !== next.url || (next.generating && !prev.generating)
}

// Pages left to restore scroll for. Each page's render fires `onRenderSuccess`, and only the renders of
// the change that set the counter (load, url change, zoom) may restore; later ones must not.
export function afterPageRender(pending: number): { restore: boolean; pending: number } {
  return { restore: pending > 0, pending: Math.max(pending - 1, 0) }
}

// A zoom scales the page layout, so the same reading position sits at the offsets times the ratio.
export function scaleScroll(pos: { top: number; left: number }, ratio: number) {
  return { top: pos.top * ratio, left: pos.left * ratio }
}

// While restores are still pending, the live offsets are mid-render and lie, so a zoom scales the
// captured position instead; Infinity (document still loading) stays Infinity until the load clamps it.
export function zoomScrollState(args: {
  pending: number
  captured: { top: number; left: number }
  live: { top: number; left: number }
  ratio: number
  numPages: number
}): { captured: { top: number; left: number }; pending: number } {
  const { pending, captured, live, ratio, numPages } = args
  if (pending > 0) {
    return {
      captured: scaleScroll(captured, ratio),
      pending: pending === Infinity ? Infinity : numPages,
    }
  }
  return { captured: scaleScroll(live, ratio), pending: numPages }
}
