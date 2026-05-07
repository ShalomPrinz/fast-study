import type { FileStatus, Course } from '../types'

export interface LayoutContext {
  courses: Course[]
  files: FileStatus | null
  refreshCourses: () => void
}
