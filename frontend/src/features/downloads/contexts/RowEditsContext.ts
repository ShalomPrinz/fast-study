import { createContext, useContext } from 'react'
import type { Course, Kind } from '@/types'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import type { Item } from '../services/autoDownloader'
import { suggestItemName } from '../utils/nameSuggestion'

// Overrides only — an absent field means "still following the suggestion".
export interface RowEdit {
  name?: string
  kind?: Kind
}

// One section's per-row (name, kind) edits, keyed by item ref so a leaf row can reach its own
// without being prop-drilled through the recursive expandable rows. Lifted to SectionGroup so
// the green "already downloaded" row and the "Download all" skip rule read the same values.
export interface RowEditsValue {
  edits: Record<string, RowEdit>
  setName: (ref: string, name: string) => void
  setKind: (ref: string, kind: Kind) => void
}

export const RowEditsContext = createContext<RowEditsValue | null>(null)

interface Resolved {
  kind: Kind
  suggestion: string
  value: string   // what the input shows
  name: string    // what a download uses — blank input falls back to the suggestion
}

// Storing only overrides makes the "user hasn't typed yet" flag fall out: with no `name`
// override the derived name keeps tracking the kind toggle, and typing pins it.
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

export function useRowEdit(item: Item, course: string) {
  const ctx = useContext(RowEditsContext)
  if (!ctx) throw new Error('useRowEdit must be used within a <SectionGroup>')
  const { courses } = useCourseTreeContext()
  return {
    ...resolveRow(item, ctx.edits[item.ref], courses, course),
    setName: (name: string) => ctx.setName(item.ref, name),
    setKind: (kind: Kind) => ctx.setKind(item.ref, kind),
  }
}
