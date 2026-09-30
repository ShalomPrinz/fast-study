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

// Block markers a snippet should not open with: heading, quote, bullet, ordered item. Each needs the
// space after it, so a line's opening `**` survives for the emphasis pass to drop as a pair.
const LEADING_MARKER = /^\s*(?:(?:#{1,6}|>|[*+-]|\d+[.)])(?=\s)\s*)*/

// Separator between table cells in a snippet, in place of the row's inner pipes.
const CELL_SEPARATOR = ' · '

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_CHAR.test(ch)
}

function lineStartOf(content: string, index: number): number {
  return content.lastIndexOf('\n', index - 1) + 1
}

function lineEndOf(content: string, index: number): number {
  const i = content.indexOf('\n', index)
  return i === -1 ? content.length : i
}

function isTableRow(content: string, lineStart: number): boolean {
  return /^[ \t]*\|/.test(content.slice(lineStart, lineStart + 16))
}

// A `|---|:--:|` row is table syntax, never content a user searched for.
function isTableSeparator(content: string, lineStart: number, lineEnd: number): boolean {
  const line = content.slice(lineStart, lineEnd)
  return /^[\s|:-]+$/.test(line) && line.includes('|') && line.includes('-')
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
      if (
        /^[\s|:-]+$/.test(m[0]) &&
        isTableSeparator(content, lineStartOf(content, index), lineEndOf(content, end))
      )
        continue
      matches.push({ summary, index, end })
    }
  }

  return matches
}

// One match's window: its whole sentence, delimiter to delimiter, or its whole row in a table. Never
// length-clamped — a character cut lands mid-word.
function windowFor(match: Match): { from: number; to: number } {
  const { content } = match.summary
  const { index: start, end } = match

  const lineStart = lineStartOf(content, start)
  if (isTableRow(content, lineStart)) {
    const lineEnd = lineEndOf(content, end)
    const line = content.slice(lineStart, lineEnd)
    const from = lineStart + (/^\s*\|?\s*/.exec(line)?.[0].length ?? 0)
    const to = lineEnd - (/\s*\|?\s*$/.exec(line)?.[0].length ?? 0)
    return { from: Math.min(from, start), to: Math.max(to, end) }
  }

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

// Inline markup to rewrite on one line, keyed by raw offset: paired `**`/`__` dropped, a table row's
// pipes turned into a cell separator. `$…$` math and `` `code` `` are skipped whole.
function markupEdits(
  content: string,
  lineStart: number,
  lineEnd: number,
  edits: Map<number, string>,
) {
  const table = isTableRow(content, lineStart)
  const open: Record<string, number | undefined> = {}

  for (let i = lineStart; i < lineEnd; i++) {
    const ch = content[i]
    if (ch === '\\') {
      i++
    } else if (ch === '$' || ch === '`') {
      const fence = ch === '$' && content[i + 1] === '$' ? '$$' : ch
      const close = content.indexOf(fence, i + fence.length)
      if (close !== -1 && close < lineEnd) i = close + fence.length - 1
    } else if (ch === '|') {
      if (table) edits.set(i, CELL_SEPARATOR)
    } else if ((ch === '*' || ch === '_') && content[i + 1] === ch) {
      const marker = ch + ch
      const opener = open[marker]
      // Intraword `__` (snake__case) is not emphasis; `**` is emphasis anywhere.
      if (opener === undefined) {
        if (ch === '*' || !isWordChar(content[i - 1])) open[marker] = i
      } else if (ch === '*' || !isWordChar(content[i + 2])) {
        for (const at of [opener, opener + 1, i, i + 1]) edits.set(at, '')
        open[marker] = undefined
      }
      i++
    }
  }
}

/** One group's snippet — markdown markup rewritten, whitespace collapsed — with each occurrence's
 *  offset. The only phase that builds strings. */
export function buildHit(group: MatchGroup): Hit {
  const { summary, matches, from, to } = group
  const { content } = summary

  // Pairing is decided on whole lines: a sentence window can hold only the closing `**` of a pair.
  const edits = new Map<number, string>()
  for (let ls = lineStartOf(content, from); ls < to; ls = lineEndOf(content, ls) + 1)
    markupEdits(content, ls, lineEndOf(content, ls), edits)

  let snippet = ''
  const emit = (text: string) => {
    for (const c of text) {
      if (!/\s/.test(c)) snippet += c
      else if (snippet && !snippet.endsWith(' ')) snippet += ' '
    }
  }

  // Raw offsets map to snippet offsets as the walk goes, so a range is recorded where it lands. A
  // match's own characters are never rewritten: a query for literal markup stays highlighted.
  const ranges: { start: number; end: number }[] = []
  let m = 0
  let start = 0
  for (let i = from; i < to; i++) {
    const match = matches[m]
    if (match && i === match.index) start = snippet.length
    const inMatch = match !== undefined && i >= match.index
    emit(inMatch ? content[i] : (edits.get(i) ?? content[i]))
    if (match && i === match.end - 1) {
      ranges.push({ start, end: snippet.length })
      m++
    }
  }

  return { summary, snippet: snippet.trimEnd(), ranges }
}
