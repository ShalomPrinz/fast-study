import { describe, it, expect } from 'vitest'
import { EditorState, EditorSelection } from '@codemirror/state'
import { docEdgeSelection } from './docEdge'

const doc = 'שורה ראשונה\nשורה שנייה\nשורה אחרונה'
const at = (anchor: number, head = anchor) =>
  EditorState.create({ doc, selection: EditorSelection.single(anchor, head) })

describe('docEdgeSelection', () => {
  it('moves the caret to the end of the document', () => {
    expect(docEdgeSelection(at(3), true, false).main).toMatchObject({
      anchor: doc.length,
      head: doc.length,
    })
  })

  it('moves the caret to the start of the document', () => {
    expect(docEdgeSelection(at(15), false, false).main).toMatchObject({ anchor: 0, head: 0 })
  })

  it('extends from the anchor to the end', () => {
    expect(docEdgeSelection(at(3, 7), true, true).main).toMatchObject({
      anchor: 3,
      head: doc.length,
    })
  })

  it('extends from the anchor to the start', () => {
    expect(docEdgeSelection(at(15, 20), false, true).main).toMatchObject({ anchor: 15, head: 0 })
  })
})
