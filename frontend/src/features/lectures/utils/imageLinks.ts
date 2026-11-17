// The PDF build copies only the lecture's `figures/` folder, so an image link is real only as
// `figures/<name>`; the render drops any other silently.

import { scanCodeFences, scanMath } from './mdDecorations'

export const FIGURES_DIR = 'figures/'

export interface ImageLink {
  // The link target's span in the text.
  from: number
  to: number
  src: string
}

// `![caption](target "title")`: the target ends at whitespace (a title follows) or the closing paren.
// An angle-bracket target (`<figures/a b.png>`) may hold spaces.
const IMAGE_LINK = /!\[[^\]\n]*\]\((<[^>\n]*>|[^)\s]*)/g
const INLINE_CODE = /(`+)(.+?)\1/g
// The same shape cut off at the cursor.
const OPEN_TARGET = /!\[[^\]\n]*\]\(([^)\s]*)$/

// Links inside code fences, inline code and math are literal text, so they are skipped.
export function scanImageLinks(text: string): ImageLink[] {
  const literal: { from: number; to: number }[] = [
    ...scanCodeFences(text),
    ...scanMath(text),
    ...Array.from(text.matchAll(INLINE_CODE), (m) => ({
      from: m.index,
      to: m.index + m[0].length,
    })),
  ]
  const links: ImageLink[] = []
  for (const m of text.matchAll(IMAGE_LINK)) {
    if (literal.some((r) => m.index >= r.from && m.index < r.to)) continue
    const src = m[1]
    const from = m.index + m[0].length - src.length
    links.push({ from, to: from + src.length, src })
  }
  return links
}

// The path the renderer opens: angle brackets and a leading `./` do not change what the target names.
function normalizeTarget(src: string): string {
  let t = src.startsWith('<') && src.endsWith('>') ? src.slice(1, -1) : src
  while (t.startsWith('./')) t = t.slice(2)
  return t
}

// Image links whose target is not a listed figure. A null list (fetch failed) flags nothing.
export function missingImageLinks(text: string, figures: string[] | null): ImageLink[] {
  if (!figures) return []
  const known = new Set(figures.map((name) => FIGURES_DIR + name))
  return scanImageLinks(text).filter((link) => !known.has(normalizeTarget(link.src)))
}

export interface FigureSuggestions {
  // Where the typed target starts; the options replace `from`..the cursor.
  from: number
  options: string[]
}

// What to offer at the end of `linePrefix` (the line up to the cursor, which starts at `lineFrom`).
// Null outside an image link's target, or with no figures to offer.
export function figureSuggestions(
  linePrefix: string,
  lineFrom: number,
  figures: string[] | null,
): FigureSuggestions | null {
  if (!figures?.length) return null
  const m = OPEN_TARGET.exec(linePrefix)
  if (!m) return null
  return {
    from: lineFrom + linePrefix.length - m[1].length,
    options: figures.map((name) => FIGURES_DIR + name),
  }
}
