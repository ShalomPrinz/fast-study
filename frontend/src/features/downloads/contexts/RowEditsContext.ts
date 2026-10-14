import { createContext, useCallback, useContext, useState } from 'react'
import type { Course, Kind } from '@/types'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import type { Item } from '../services/autoDownloader'
import { suggestItemName } from '../utils/nameFromTitle'

// Overrides only — an absent field means "still following the suggestion".
export interface RowEdit {
  name?: string
  kind?: Kind
}

// The (name, kind) a row's download was submitted under, so its suggestion stops moving once that
// lecture lands in the tree. Mount-scoped: names are worked out afresh on the next visit.
export interface RowLock {
  course: string
  name: string
  kind: Kind
}

export interface RowEditsDispatch {
  setName: (ref: string, name: string) => void
  setKind: (ref: string, kind: Kind) => void
  lock: (ref: string, lock: RowLock) => void
}

// Per-row (name, kind) overrides keyed by ref. State and dispatch are split so a keystroke re-renders
// only the rows that slice the map — see docs/DOWNLOADS.md.
export const RowEditsStateContext = createContext<Record<string, RowEdit> | null>(null)
export const RowEditsDispatchContext = createContext<RowEditsDispatch | null>(null)
export const RowLocksContext = createContext<Record<string, RowLock>>({})

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

export function useRowLocksMap(): Record<string, RowLock> {
  return useContext(RowLocksContext)
}

// The lock store, owned by DownloadsView so it dies with the page. Same structural sharing as edits.
export function useRowLocks() {
  const [locks, setLocks] = useState<Record<string, RowLock>>({})
  const lock = useCallback((ref: string, next: RowLock) => {
    setLocks((prev) => ({ ...prev, [ref]: next }))
  }, [])
  return { locks, lock }
}

interface Resolved {
  kind: Kind
  suggestion: string
  value: string // what the input shows
  name: string // what a download uses — blank input falls back to the suggestion
}

// Storing overrides only: with no `name` set the derived name keeps tracking the kind toggle,
// and the first keystroke pins it. A lock stands in for the suggestion only under its own course and kind.
export function resolveRow(
  item: Item,
  edit: RowEdit | undefined,
  courses: Course[],
  course: string,
  lock?: RowLock,
): Resolved {
  const kind = edit?.kind ?? item.kind
  const suggestion =
    lock && lock.course === course && lock.kind === kind
      ? lock.name
      : suggestItemName(item.title, kind, courses, course)
  const value = edit?.name ?? suggestion
  return { kind, suggestion, value, name: value.trim() || suggestion }
}

export function useRowEdit(
  item: Item,
  edit: RowEdit | undefined,
  course: string,
  lock: RowLock | undefined,
) {
  const dispatch = useRowEditsDispatch()
  const { courses } = useCourseTreeContext()
  return {
    ...resolveRow(item, edit, courses, course, lock),
    setName: (name: string) => dispatch.setName(item.ref, name),
    setKind: (kind: Kind) => dispatch.setKind(item.ref, kind),
  }
}
