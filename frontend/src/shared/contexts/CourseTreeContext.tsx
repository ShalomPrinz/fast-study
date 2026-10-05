import { createContext, useContext } from 'react'
import type { Course } from '@/types'

// Provided by `SnapshotProvider`, which refreshes the tree together with `/status`.
interface CourseTreeValue {
  courses: Course[]
  loaded: boolean
  refreshCourses: () => Promise<void>
}

export const CourseTreeContext = createContext<CourseTreeValue | null>(null)

export function useCourseTreeContext(): CourseTreeValue {
  const ctx = useContext(CourseTreeContext)
  if (!ctx) throw new Error('useCourseTreeContext must be used inside <SnapshotProvider>')
  return ctx
}
