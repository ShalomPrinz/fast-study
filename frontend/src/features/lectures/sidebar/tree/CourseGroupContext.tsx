import { createContext, useContext } from 'react'
import type { Course } from '@/types'
import type { AddLecture } from '@/features/lectures/hooks/useAddLecture'

// One course group's course + add-lecture flow, reachable without prop-drilling.
export interface CourseGroupValue {
  course: Course
  add: AddLecture
}

export const CourseGroupContext = createContext<CourseGroupValue | null>(null)

export function useCourseGroup(): CourseGroupValue {
  const ctx = useContext(CourseGroupContext)
  if (!ctx) throw new Error('useCourseGroup must be used within a <CourseGroup>')
  return ctx
}
