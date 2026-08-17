import { createContext, useContext } from 'react'
import type { Course, Kind } from '@/types'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import type { Item } from '../services/autoDownloader'
import { suggestItemName } from '../utils/nameFromTitle'

// Overrides only — an absent field means "still following the suggestion".
export interface RowEdit {
  name?: string
  kind?: Kind
}

export interface RowEditsDispatch {
  setName: (ref: string, name: string) => void
  setKind: (ref: string, kind: Kind) => void
}

// The course's per-row (name, kind) edits, keyed by item ref — reaches recursive rows without
// prop-drilling, and keeps the green row and the bulk skip rule reading the same values. State and
// dispatch are separate contexts so a keystroke only invalidates the rows that slice the map:
// leaf rows read the stable dispatch and take their own slice as a prop.
export const RowEditsStateContext = createContext<Record<string, RowEdit> | null>(null)
export const RowEditsDispatchContext = createContext<RowEditsDispatch | null>(null)

export function useRowEdits(): Record<string, RowEdit> {
  const edits = useContext(RowEditsStateContext)
  if (!edits) throw new Error('useRowEdits must be used within a <DownloadsView>')
  return edits
}

export function useRowEditsDispatch(): RowEditsDispatch {
  const dispatch = useContext(RowEditsDispatchContext)
  if (!dispatch) throw new Error('useRowEditsDispatch must be used within a <DownloadsView>')
  return dispatch
}

interface Resolved {
  kind: Kind
  suggestion: string
  value: string // what the input shows
  name: string // what a download uses — blank input falls back to the suggestion
}

// Storing overrides only: with no `name` set the derived name keeps tracking the kind toggle,
// and the first keystroke pins it.
export function resolveRow(
  item: Item,
  edit: RowEdit | undefined,
  courses: Course[],
  course: string,
): Resolved {
  const kind = edit?.kind ?? item.kind
  const suggestion = suggestItemName(item.title, kind, courses, course)
  const value = edit?.name ?? suggestion
  return { kind, suggestion, value, name: value.trim() || suggestion }
}

export function useRowEdit(item: Item, edit: RowEdit | undefined, course: string) {
  const dispatch = useRowEditsDispatch()
  const { courses } = useCourseTreeContext()
  return {
    ...resolveRow(item, edit, courses, course),
    setName: (name: string) => dispatch.setName(item.ref, name),
    setKind: (kind: Kind) => dispatch.setKind(item.ref, kind),
  }
}
