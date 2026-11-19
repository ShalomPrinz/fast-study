// The index a navigation key moves to in a list of `count` rows, or null when the key is not one.
// ArrowUp from -1 (nothing active) lands on the last row.
export function nextIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null
  switch (key) {
    case 'ArrowDown':
      return (current + 1) % count
    case 'ArrowUp':
      return current < 0 ? count - 1 : (current - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}

// The row a type-ahead buffer points at: the first label starting with it, case-insensitively, wrapping.
// A one-letter buffer, or one letter repeated ("tt"), searches from the row after `current` so it cycles;
// a longer prefix searches from `current` itself so it stays on a row that still matches.
export function typeAheadIndex(
  buffer: string,
  labels: readonly string[],
  current: number,
): number | null {
  let needle = buffer.toLowerCase()
  if (!needle) return null
  const chars = [...needle]
  if (chars.every((c) => c === chars[0])) needle = chars[0]
  const first = chars.length > 1 && needle.length > 1 ? 0 : 1
  for (let step = first; step < labels.length + first; step++) {
    const i =
      ((((current < 0 && first === 0 ? 0 : current) + step) % labels.length) + labels.length) %
      labels.length
    if (labels[i].toLowerCase().startsWith(needle)) return i
  }
  return null
}
