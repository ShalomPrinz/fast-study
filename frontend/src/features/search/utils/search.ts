import type { CourseSummary } from '@/types'

// A match is position-only and holds its summary by reference — no copy of the content, no lookup
// table, and nothing else to pass when a snippet is finally built for it.
export interface Match {
  summary: CourseSummary
  index: number
  end: number
}

// A run of matches close enough to share one snippet, with the content window that snippet will
// cover. Still cheap: positions only, no strings built.
export interface MatchGroup {
  summary: CourseSummary
  matches: Match[]
  from: number
  to: number
}

export interface Hit {
  summary: CourseSummary
  snippet: string
  // Occurrence offsets *within* `snippet`, so the view can wrap each span without parsing HTML.
  ranges: { start: number; end: number }[]
}

// JS `\b` ignores Hebrew, so word boundaries check this class. Letters and niqqud only: Hebrew
// punctuation separates words (״ספר״) as Latin punctuation does.
const WORD_CHAR = /[0-9A-Za-z_\u05B0-\u05BD\u05BF\u05C1\u05C2\u05C7\u05D0-\u05EA\u05EF-\u05F2]/

// Sentence separators: terminal and clause punctuation, plus any line break — in markdown a newline
// is what ends a heading, a bullet or a paragraph.
const DELIMITER = /[.?!;:…\n\r]/

// Markdown markers a snippet should not open with, once the line break before them is its delimiter.
const LEADING_MARKER = /^[\s#>*+-]+/

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_CHAR.test(ch)
}

/** Every case-insensitive occurrence as a position only — strings are left to `buildHit`, since a
 *  one-letter Hebrew query matches ~15k times. See docs/SEARCH.md. */
export function findMatches(
  summaries: CourseSummary[],
  query: string,
  options: { wholeWord?: boolean } = {},
): Match[] {
  const needle = query.trim()
  if (!needle) return []

  const re = new RegExp(escapeRegExp(needle), 'gi')
  const matches: Match[] = []

  for (const summary of summaries) {
    const { content } = summary
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(content)) !== null) {
      const index = m.index
      const end = index + m[0].length
      if (options.wholeWord && (isWordChar(content[index - 1]) || isWordChar(content[end])))
        continue
      matches.push({ summary, index, end })
    }
  }

  return matches
}

// One match's window: its whole sentence, delimiter to delimiter. Never length-clamped — a character
// cut lands mid-word.
function windowFor(match: Match): { from: number; to: number } {
  const { content } = match.summary
  const { index: start, end } = match

  let from = 0
  for (let i = start - 1; i >= 0; i--) {
    if (DELIMITER.test(content[i])) {
      from = i + 1
      break
    }
  }

  let to = content.length
  for (let i = end; i < content.length; i++) {
    if (DELIMITER.test(content[i])) {
      to = i + 1
      break
    }
  }

  from += LEADING_MARKER.exec(content.slice(from, start))?.[0].length ?? 0
  while (to > end && /\s/.test(content[to - 1])) to--

  return { from, to }
}

/** Merges matches whose windows touch or overlap — exactly those sharing a sentence — into one group.
 *  Relies on `findMatches` order; groups never span summaries. */
export function groupMatches(matches: Match[]): MatchGroup[] {
  const groups: MatchGroup[] = []

  for (const match of matches) {
    const { from, to } = windowFor(match)
    const last = groups[groups.length - 1]
    if (last && last.summary === match.summary && from <= last.to) {
      last.matches.push(match)
      last.to = Math.max(last.to, to)
    } else {
      groups.push({ summary: match.summary, matches: [match], from, to })
    }
  }

  return groups
}

/** One group's snippet, whitespace collapsed, with each occurrence's offset. The only phase that
 *  builds strings. */
export function buildHit(group: MatchGroup): Hit {
  const { summary, matches, from, to } = group
  const { content } = summary

  // Collapsing each segment separately is safe only because the needle is trimmed: a match never
  // starts or ends on whitespace, so no whitespace run can straddle a match boundary.
  let snippet = content.slice(from, matches[0].index).replace(/\s+/g, ' ')
  const ranges: { start: number; end: number }[] = []

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]
    const start = snippet.length
    snippet += content.slice(match.index, match.end).replace(/\s+/g, ' ')
    ranges.push({ start, end: snippet.length })
    const nextStart = i + 1 < matches.length ? matches[i + 1].index : to
    snippet += content.slice(match.end, nextStart).replace(/\s+/g, ' ')
  }

  return { summary, snippet, ranges }
}
