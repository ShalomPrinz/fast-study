import type { CourseStructure } from '@/services/settings'

// The course checklist under "specific courses". It reads each course's resolved `lectures_only`, which
// equals its pick only while the live mode is `lectures_some` — so until that mode is saved it waits.
export function checklistState(
  form: CourseStructure,
  saved: CourseStructure,
): 'hidden' | 'saveFirst' | 'list' {
  if (form !== 'lectures_some') return 'hidden'
  return saved === 'lectures_some' ? 'list' : 'saveFirst'
}
