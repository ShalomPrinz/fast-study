// Open upward only when the list overflows below the viewport and the button has more room above; gap mirrors --space-2.
export function shouldOpenUp(
  button: { top: number; bottom: number },
  listHeight: number,
  viewportHeight: number,
  gap = 6,
): boolean {
  const below = viewportHeight - button.bottom - gap
  const above = button.top - gap
  return listHeight > below && above > below
}
