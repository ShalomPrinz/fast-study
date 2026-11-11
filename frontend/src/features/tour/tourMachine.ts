// The slide after moving by `delta`, kept inside [0, total).
export function moveSlide(index: number, delta: number, total: number): number {
  return Math.min(total - 1, Math.max(0, index + delta))
}

// What an arrow key does to the slide index: the arrow points the way the content travels, so RTL mirrors it. Other keys: null.
export function arrowDelta(key: string, rtl: boolean): 1 | -1 | null {
  if (key !== 'ArrowRight' && key !== 'ArrowLeft') return null
  return (key === 'ArrowRight') !== rtl ? 1 : -1
}
