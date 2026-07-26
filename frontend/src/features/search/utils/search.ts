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

// Hebrew is invisible to JS `\b`, so word boundaries are checked against this class explicitly
// rather than by anchoring the RegExp. Letters and niqqud only: the block's punctuation — geresh,
// gershayim, maqaf, sof pasuq — separates words (״ספר״, תנ״ך) exactly as Latin punctuation does.
const WORD_CHAR = /[0-9A-Za-z_\u05B0-\u05BD\u05BF\u05C1\u05C2\u05C7\u05D0-\u05EA\u05EF-\u05F2]/

// A sentence ends at '.', per the summaries' own writing style.
const TERMINATOR = '.'

// Context kept around a single match once its sentence window is longer than a card should show.
const MAX_BEFORE = 140
const MAX_AFTER = 200

const ELLIPSIS = '…'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_CHAR.test(ch)
}

/**
 * Every occurrence of `query` across the given summaries, as positions only. Case-insensitive
 * substring; `wholeWord` additionally requires a non-word character (or a text edge) on both sides.
 * Deliberately cheap — a one-letter Hebrew query matches ~15k times, and building a snippet for each
 * costs ~1s, so strings are left to `buildHit` for the handful of groups actually rendered.
 */
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

// The content window one match would show on its own: its sentence plus the one before and after,
// clamped so a summary with few periods can't dump a whole document into one card.
function windowFor(match: Match): { from: number; to: number } {
  const { content } = match.summary
  const { index: start, end } = match

  const prev1 = start > 0 ? content.lastIndexOf(TERMINATOR, start - 1) : -1
  const prev2 = prev1 > 0 ? content.lastIndexOf(TERMINATOR, prev1 - 1) : -1
  const next1 = content.indexOf(TERMINATOR, end)
  const next2 = next1 >= 0 ? content.indexOf(TERMINATOR, next1 + 1) : -1

  let from = Math.max(prev2 + 1, start - MAX_BEFORE)
  let to = Math.min(next2 >= 0 ? next2 + 1 : content.length, end + MAX_AFTER)
  while (from < start && /\s/.test(content[from])) from++
  while (to > end && /\s/.test(content[to - 1])) to--

  return { from, to }
}

/**
 * Collapses matches whose windows touch or overlap into one group, so nearby matches yield a single
 * snippet with several highlights instead of near-duplicate cards. A merged window is deliberately
 * uncapped — the per-match clamp still bounds each window, but a long run merges completely.
 * Relies on `findMatches` order (by summary, then ascending index); groups never span summaries.
 */
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

/**
 * The snippet for one group: its window with every whitespace run collapsed to a single space, plus
 * the offset of each occurrence inside the result. The only phase that builds strings.
 */
export function buildHit(group: MatchGroup): Hit {
  const { summary, matches, from, to } = group
  const { content } = summary

  // Collapsing each segment separately is safe only because the needle is trimmed: a match never
  // starts or ends on whitespace, so no whitespace run can straddle a match boundary.
  let snippet =
    (from > 0 ? ELLIPSIS : '') + content.slice(from, matches[0].index).replace(/\s+/g, ' ')
  const ranges: { start: number; end: number }[] = []

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]
    const start = snippet.length
    snippet += content.slice(match.index, match.end).replace(/\s+/g, ' ')
    ranges.push({ start, end: snippet.length })
    const nextStart = i + 1 < matches.length ? matches[i + 1].index : to
    snippet += content.slice(match.end, nextStart).replace(/\s+/g, ' ')
  }

  return { summary, snippet: snippet + (to < content.length ? ELLIPSIS : ''), ranges }
}
