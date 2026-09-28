import { EditorSelection } from '@codemirror/state'
import type { EditorState } from '@codemirror/state'

// The selection Ctrl+Home/End (with Shift, extending) leaves: the document's first or last position.
// Pure so it can be tested without an editor; `MarkdownEditor` binds it, since without `basicSetup`
// the keys fall to contenteditable, which only knows the lines CodeMirror has rendered.
export function docEdgeSelection(
  state: EditorState,
  end: boolean,
  extend: boolean,
): EditorSelection {
  const pos = end ? state.doc.length : 0
  return EditorSelection.single(extend ? state.selection.main.anchor : pos, pos)
}
