import { useEffect, useRef } from 'react'
import { EditorState, Transaction } from '@codemirror/state'
import type { Range, Text } from '@codemirror/state'
import { EditorView, ViewPlugin, Decoration, keymap } from '@codemirror/view'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { markdown } from '@codemirror/lang-markdown'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { tags } from '@lezer/highlight'
import { scanCallouts, scanCodeFences, scanMath } from '@/features/lectures/utils/mdDecorations'
import type { CalloutClass } from '@/features/lectures/utils/mdDecorations'
import './MarkdownEditor.css'

// Hebrew markdown is prose with marks in it, so the surface keeps the UI font and the wide leading
// long RTL paragraphs need — never CodeMirror's monospace default.
const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--fs-row)',
    color: 'var(--text)',
    backgroundColor: 'var(--surface)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.85' },
  '.cm-content': { padding: 'var(--space-7)', caretColor: 'var(--text)' },
})

const summaryHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: 'var(--fs-title)', fontWeight: '600' },
  { tag: tags.heading2, fontSize: 'var(--fs-section)', fontWeight: '600' },
  { tag: tags.heading3, fontWeight: '700' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.monospace, fontFamily: 'var(--font-mono)', direction: 'ltr', unicodeBidi: 'isolate' },
  // Last, because a marker also carries the tag of the heading or emphasis it sits inside and the
  // later rule wins: dimming it is what lets structure read at a glance with the raw text intact.
  { tag: tags.processingInstruction, color: 'var(--text-4)', fontWeight: '400' },
  // Exactly two `---` carry the document's structure and a miscount breaks the PDF, so they read
  // as a tinted chip rather than three faint dashes.
  {
    tag: tags.contentSeparator,
    color: 'var(--accent-ink)',
    fontWeight: '700',
    backgroundColor: 'var(--accent-soft)',
    letterSpacing: '2px',
  },
])

const calloutLine: Record<CalloutClass, Decoration> = {
  definition: Decoration.line({ class: 'cm-callout cm-callout--definition' }),
  warning: Decoration.line({ class: 'cm-callout cm-callout--warning' }),
  insight: Decoration.line({ class: 'cm-callout cm-callout--insight' }),
}
const mathMark = Decoration.mark({ class: 'cm-math' })
// Per line, not per span: a Hebrew line has an RTL base direction, which no inline isolate on the code
// text can undo.
const codeLine = Decoration.line({ class: 'cm-code-line' })
// Each line with a letter takes its direction from its first one, so an English title never flips the
// Hebrew paragraphs under it. A line with none (blank, `---`, a table rule) inherits `contentDir`'s.
const autoDirLine = Decoration.line({ attributes: { dir: 'auto' } })
const LETTER = /\p{L}/u
const RTL_LETTER = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/

// Any Hebrew makes the summary an RTL document; one with none (English) reads LTR.
const contentDir = EditorView.contentAttributes.compute(['doc'], (state) => ({
  dir: RTL_LETTER.test(state.doc.toString()) ? 'rtl' : 'ltr',
  spellcheck: 'false',
}))

// Scanned whole rather than over the viewport: a callout can straddle the viewport edge, and one
// summary is a few pages of text.
function buildDecorations(doc: Text): DecorationSet {
  const text = doc.toString()
  const ranges: Range<Decoration>[] = []
  for (const callout of scanCallouts(text)) {
    for (let pos = callout.from; pos <= callout.to;) {
      const line = doc.lineAt(pos)
      ranges.push(calloutLine[callout.cls].range(line.from))
      pos = line.to + 1
    }
  }
  const codeLines = new Set<number>()
  for (const fence of scanCodeFences(text)) {
    for (let pos = fence.from; pos <= fence.to;) {
      const line = doc.lineAt(pos)
      ranges.push(codeLine.range(line.from))
      codeLines.add(line.from)
      pos = line.to + 1
    }
  }
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n)
    if (!codeLines.has(line.from) && LETTER.test(line.text))
      ranges.push(autoDirLine.range(line.from))
  }
  for (const math of scanMath(text)) ranges.push(mathMark.range(math.from, math.to))
  return Decoration.set(ranges, true)
}

const dialectDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view.state.doc)
    }

    update(update: ViewUpdate) {
      if (update.docChanged) this.decorations = buildDecorations(update.state.doc)
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

interface Props {
  value: string
  onChange: (value: string) => void
}

export default function MarkdownEditor({ value, onChange }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          markdown(),
          // Unbound, keys fall to contenteditable, whose Ctrl+Home/End only reach the rendered lines.
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          syntaxHighlighting(summaryHighlight),
          dialectDecorations,
          editorTheme,
          EditorView.lineWrapping,
          // Lines set their own direction (`autoDirLine`); this tells cursor motion to follow each one.
          EditorView.perLineTextDirection.of(true),
          contentDir,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString())
          }),
        ],
      }),
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    // CodeMirror owns the buffer, so only a value that did not come from it is pushed in — without
    // this guard the editor's own edits echo back through `value` and reset the selection.
    if (value === view.state.doc.toString()) return
    // Kept out of undo history: a pushed value is a reload or Restore, which Ctrl+Z must not reverse.
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      annotations: Transaction.addToHistory.of(false),
    })
  }, [value])

  return <div className="markdown-editor" ref={hostRef} />
}
