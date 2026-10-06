export interface PdfViewState {
  url: string
  generating: boolean
}

// The scroll position is worth capturing on the last render that still shows the old pages: a new url
// replaces them, and a generate starting unmounts them under the spinner before the new url arrives.
export function shouldCaptureScroll(prev: PdfViewState, next: PdfViewState): boolean {
  return prev.url !== next.url || (next.generating && !prev.generating)
}
