// Where Tab goes inside the dialog: wraps at both ends, and pulls focus in from outside; null leaves the browser's move alone.
export function tabTarget<E>(items: E[], current: E | null, shift: boolean): E | null {
  if (items.length === 0) return null
  const at = current === null ? -1 : items.indexOf(current)
  if (at === -1) return shift ? items[items.length - 1] : items[0]
  if (shift && at === 0) return items[items.length - 1]
  if (!shift && at === items.length - 1) return items[0]
  return null
}

interface FocusDoc<E> {
  activeElement: E | null
}

// Remembers the focused element now; the returned function puts focus back if it is still in the page.
export function rememberFocus<E extends { isConnected: boolean; focus: () => void }>(
  doc: FocusDoc<E>,
): () => void {
  const was = doc.activeElement
  return () => {
    if (was?.isConnected) was.focus()
  }
}
