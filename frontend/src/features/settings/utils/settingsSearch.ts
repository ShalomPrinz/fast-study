// One searchable piece of the page: a text node, or a `<select>` whose option text counts as one hit.
export interface SearchSource {
  text: string
  whole?: boolean
}

export interface SearchMatch {
  source: number
  start: number
  length: number
}

// Folds one code point at a time, keeping any char whose lowercase changes its UTF-16 length, so indices in the folded string are indices in the original.
function fold(text: string): string {
  let out = ''
  for (const ch of text) {
    const lower = ch.toLowerCase()
    out += lower.length === ch.length ? lower : ch
  }
  return out
}

// Every case-insensitive, non-overlapping hit of the query, in source order; a `whole` source gives at most one.
export function findMatches(sources: SearchSource[], query: string): SearchMatch[] {
  const needle = fold(query.trim())
  if (!needle) return []
  const found: SearchMatch[] = []
  sources.forEach((src, source) => {
    const hay = fold(src.text)
    let from = 0
    for (;;) {
      const at = hay.indexOf(needle, from)
      if (at < 0) break
      if (src.whole) {
        found.push({ source, start: 0, length: src.text.length })
        break
      }
      found.push({ source, start: at, length: needle.length })
      from = at + needle.length
    }
  })
  return found
}

// The next or previous match index, wrapping at both ends; 0 when there is nothing to step through.
export function stepMatch(current: number, count: number, direction: 1 | -1): number {
  if (count <= 0) return 0
  return (current + direction + count) % count
}
