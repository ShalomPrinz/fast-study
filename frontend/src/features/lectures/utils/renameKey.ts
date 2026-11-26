// The keyboard gestures that open a course rename: Enter, Space (ARIA button) and F2.
export function isRenameKey(e: { key: string; shiftKey: boolean }): boolean {
  return e.key === 'F2' || e.key === 'Enter' || e.key === ' '
}
