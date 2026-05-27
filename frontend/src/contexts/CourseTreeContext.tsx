import { createContext, useContext, useState, useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { Course } from '../types'
import { fetchTree, fetchCourse } from '../services/database'
import { useNotify } from '../hooks/useNotify'

interface CourseTreeValue {
  courses: Course[]
  refreshCourses: () => Promise<void>
  onCourseClick: (course: string) => void
}

const CourseTreeContext = createContext<CourseTreeValue | null>(null)

export function CourseTreeProvider({ children }: { children: ReactNode }) {
  const [courses, setCourses] = useState<Course[]>([])

  function refreshCourses() {
    return fetchTree().then(setCourses)
  }

  useEffect(() => {
    refreshCourses()
  }, [])

  useNotify(refreshCourses)

  const sortedCourses = useMemo(
    () => courses.map((c) => ({
      ...c,
      lectures: [...c.lectures].sort((a, b) => a.name.localeCompare(b.name)),
      recitations: [...(c.recitations ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    })),
    [courses]
  )

  function onCourseClick(courseName: string) {
    fetchCourse(courseName).then((updated) => {
      if (!updated) return
      setCourses((prev) => prev.map((c) => (c.name === courseName ? updated : c)))
    })
  }

  return (
    <CourseTreeContext.Provider value={{ courses: sortedCourses, refreshCourses, onCourseClick }}>
      {children}
    </CourseTreeContext.Provider>
  )
}

export function useCourseTreeContext(): CourseTreeValue {
  const ctx = useContext(CourseTreeContext)
  if (!ctx) throw new Error('useCourseTreeContext must be used inside <CourseTreeProvider>')
  return ctx
}
