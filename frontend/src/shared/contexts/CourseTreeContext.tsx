import { createContext, useContext, useState, useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { Course } from '@/types'
import { fetchTree } from '@/services/database'
import { useNotify } from '@/shared/hooks/useNotify'
import { useLatestRequest } from '@/shared/hooks/useLatestRequest'
import { sortLectures } from '@/features/lectures/utils/lectureSort'

interface CourseTreeValue {
  courses: Course[]
  refreshCourses: () => Promise<void>
}

const CourseTreeContext = createContext<CourseTreeValue | null>(null)

export function CourseTreeProvider({ children }: { children: ReactNode }) {
  const [courses, setCourses] = useState<Course[]>([])
  const latest = useLatestRequest()

  async function refreshCourses() {
    const c = await latest(fetchTree())
    if (c) setCourses(c)
  }

  useEffect(() => {
    refreshCourses()
  }, [])

  useNotify(refreshCourses)

  const sortedCourses = useMemo(
    () =>
      courses.map((c) => ({
        ...c,
        lectures: sortLectures(c.lectures),
        recitations: sortLectures(c.recitations),
      })),
    [courses],
  )

  return (
    <CourseTreeContext.Provider value={{ courses: sortedCourses, refreshCourses }}>
      {children}
    </CourseTreeContext.Provider>
  )
}

export function useCourseTreeContext(): CourseTreeValue {
  const ctx = useContext(CourseTreeContext)
  if (!ctx) throw new Error('useCourseTreeContext must be used inside <CourseTreeProvider>')
  return ctx
}
