import { createContext, useContext } from 'react'
import type { Course } from '@/types'

// Provided by `SnapshotProvider`, which refreshes the tree together with `/status`.
interface CourseTreeValue {
  courses: Course[]
  loaded: boolean
  // The newest `/tree` fetch failed, so an empty `courses` says nothing about the library.
  loadFailed: boolean
  refreshCourses: () => Promise<void>
  // Refetches, settling at the first applied tree `has` accepts or once that refetch settles.
  refreshUntil: (has: (courses: Course[]) => boolean) => Promise<void>
}

export const CourseTreeContext = createContext<CourseTreeValue | null>(null)

export function useCourseTreeContext(): CourseTreeValue {
  const ctx = useContext(CourseTreeContext)
  if (!ctx) throw new Error('useCourseTreeContext must be used inside <SnapshotProvider>')
  return ctx
}
