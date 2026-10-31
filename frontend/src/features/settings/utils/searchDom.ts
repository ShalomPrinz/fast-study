import { findMatches, type SearchMatch, type SearchSource } from './settingsSearch'

const TEXT_HIGHLIGHT = 'settings-search'
const CURRENT_HIGHLIGHT = 'settings-search-current'
export const SELECT_HIT = 'settings-search-hit'
export const SELECT_CURRENT = 'settings-search-hit--current'

// A match placed in the DOM: a range inside one text node, or a whole `<select>`.
export type DomMatch = { range: Range } | { select: HTMLSelectElement }

// The CSS Custom Highlight API paints Ranges without touching React's DOM; absent, only selects mark.
const highlights = () => (typeof CSS !== 'undefined' && 'highlights' in CSS ? CSS.highlights : null)

// Everything rendered under `root` as search sources, in DOM order; input values never appear.
function collect(root: HTMLElement): {
  sources: SearchSource[]
  nodes: (Text | HTMLSelectElement)[]
} {
  const sources: SearchSource[] = []
  const nodes: (Text | HTMLSelectElement)[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n;) {
    if (n instanceof HTMLSelectElement) {
      sources.push({ text: Array.from(n.options, (o) => o.text).join(' '), whole: true })
      nodes.push(n)
      // Its option text is the select's own source; do not also walk into it.
      let last: Node = n
      while (last.lastChild) last = last.lastChild
      walker.currentNode = last
    } else if (n.nodeType === Node.TEXT_NODE && n.nodeValue?.trim()) {
      const parent = n.parentElement
      if (parent && !parent.closest('script, style, textarea')) {
        sources.push({ text: n.nodeValue })
        nodes.push(n as Text)
      }
    }
    n = walker.nextNode()
  }
  return { sources, nodes }
}

// Finds every match of the query under `root`, in DOM order.
export function scan(root: HTMLElement, query: string): DomMatch[] {
  const { sources, nodes } = collect(root)
  return findMatches(sources, query).map((m: SearchMatch) => {
    const node = nodes[m.source]
    if (node instanceof HTMLSelectElement) return { select: node }
    const range = document.createRange()
    range.setStart(node, m.start)
    range.setEnd(node, m.start + m.length)
    return { range }
  })
}

// Paints all matches softly and the current one stronger; an empty list clears everything.
export function paint(root: HTMLElement | null, matches: DomMatch[], current: number) {
  const registry = highlights()
  const ranges: Range[] = []
  const now: Range[] = []
  root?.querySelectorAll('select').forEach((s) => s.classList.remove(SELECT_HIT, SELECT_CURRENT))
  matches.forEach((m, i) => {
    if ('select' in m) {
      m.select.classList.add(SELECT_HIT)
      if (i === current) m.select.classList.add(SELECT_CURRENT)
    } else (i === current ? now : ranges).push(m.range)
  })
  registry?.set(TEXT_HIGHLIGHT, new Highlight(...ranges))
  registry?.set(CURRENT_HIGHLIGHT, new Highlight(...now))
}

export function scrollToMatch(match: DomMatch | undefined) {
  if (!match) return
  const el = 'select' in match ? match.select : match.range.startContainer.parentElement
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}
