import { createContext, useContext } from 'react'
import type { Course } from '@/types'
import type { AddLecture } from '@/hooks/useAddLecture'

// One course group's shared concern: the course it renders + its add-lecture flow.
// Lets the header / lists / items reach the course without prop-drilling it.
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
