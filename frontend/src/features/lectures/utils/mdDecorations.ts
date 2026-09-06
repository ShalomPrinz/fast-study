// Range scanners for the parts of the summary dialect `@codemirror/lang-markdown` does not parse:
// pandoc fenced-div callouts and `$…$` math. Pure so they can be tested without an editor.

export const CALLOUT_CLASSES = ['definition', 'warning', 'insight'] as const

export type CalloutClass = (typeof CALLOUT_CLASSES)[number]

export interface CalloutRange {
  cls: CalloutClass
  /** Start of the `::: <class>` line, through the end of the closing `:::` line. */
  from: number
  to: number
}

export interface MathRange {
  from: number
  to: number
  display: boolean
}

export interface TextRange {
  from: number
  to: number
}

interface Line extends TextRange {
  text: string
}

const CALLOUT_OPEN = /^:::+[ \t]*(\S+)[ \t]*$/
const CALLOUT_CLOSE = /^:::+[ \t]*$/
const FENCE = /^[ \t]*(```|~~~)/

function lines(text: string): Line[] {
  const out: Line[] = []
  let from = 0
  for (const t of text.split('\n')) {
    out.push({ text: t, from, to: from + t.length })
    from += t.length + 1
  }
  return out
}

function inRanges(ranges: TextRange[], pos: number): boolean {
  return ranges.some((r) => pos >= r.from && pos < r.to)
}

function isCalloutClass(cls: string): cls is CalloutClass {
  return (CALLOUT_CLASSES as readonly string[]).includes(cls)
}

// Fenced code blocks, opening line through closing line; an unclosed fence runs to the end of the text.
export function scanCodeFences(text: string): TextRange[] {
  const out: TextRange[] = []
  let open: Line | null = null
  for (const line of lines(text)) {
    if (!FENCE.test(line.text)) continue
    if (open) {
      out.push({ from: open.from, to: line.to })
      open = null
    } else {
      open = line
    }
  }
  if (open) out.push({ from: open.from, to: text.length })
  return out
}

// Complete `::: <class>` … `:::` blocks outside code fences. An unknown class or an unclosed block
// yields nothing, so a typo stays visibly unboxed; the dialect has no nested divs, so the first bare
// `:::` closes and an opener inside a block is content.
export function scanCallouts(text: string): CalloutRange[] {
  const fences = scanCodeFences(text)
  const out: CalloutRange[] = []
  let open: { cls: string; from: number } | null = null
  for (const line of lines(text)) {
    if (inRanges(fences, line.from)) continue
    const t = line.text.trim()
    if (!t.startsWith(':::')) continue
    if (open) {
      if (CALLOUT_CLOSE.test(t)) {
        if (isCalloutClass(open.cls)) out.push({ cls: open.cls, from: open.from, to: line.to })
        open = null
      }
      continue
    }
    const m = CALLOUT_OPEN.exec(t)
    if (m) open = { cls: m[1], from: line.from }
  }
  return out
}

// Balanced `$$…$$` (may span lines) and `$…$` (single line only, so a stray `$` in prose cannot
// swallow the rest of the document) outside code fences. An unbalanced delimiter yields nothing.
export function scanMath(text: string): MathRange[] {
  const fences = scanCodeFences(text)
  const out: MathRange[] = []
  let i = 0
  while (i < text.length) {
    const fence = fences.find((r) => i >= r.from && i < r.to)
    if (fence) {
      i = fence.to
      continue
    }
    if (text[i] !== '$') {
      i++
      continue
    }
    if (text.startsWith('$$', i)) {
      const close = text.indexOf('$$', i + 2)
      if (close === -1 || inRanges(fences, close)) {
        i += 2
        continue
      }
      out.push({ from: i, to: close + 2, display: true })
      i = close + 2
      continue
    }
    const lineEnd = text.indexOf('\n', i + 1)
    const limit = lineEnd === -1 ? text.length : lineEnd
    const close = text.indexOf('$', i + 1)
    if (close === -1 || close >= limit) {
      i++
      continue
    }
    out.push({ from: i, to: close + 1, display: false })
    i = close + 1
  }
  return out
}
