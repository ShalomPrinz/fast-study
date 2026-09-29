import { createContext, useContext, useState, useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import type { Course } from '@/types'
import { fetchTree } from '@/services/database'
import { toast } from '@/services/toaster'
import { useNotify } from '@/shared/hooks/useNotify'
import { useNewestRequest } from '@/shared/hooks/useLatestRequest'
import { useReportOnce } from '@/shared/hooks/useReportOnce'
import { sortLectures } from '@/features/lectures/utils/lectureSort'
import { announcePdfWarnings } from '@/features/lectures/utils/pdfWarnings'

interface CourseTreeValue {
  courses: Course[]
  loaded: boolean
  refreshCourses: () => Promise<void>
}

const CourseTreeContext = createContext<CourseTreeValue | null>(null)

export function CourseTreeProvider({ children }: { children: ReactNode }) {
  const [courses, setCourses] = useState<Course[]>([])
  const [loaded, setLoaded] = useState(false)
  const newest = useNewestRequest()

  // PDF render warnings ride the tree, so they are announced here rather than from /status.
  const warningReports = useReportOnce((msg) => toast('warning', msg))
  const primed = useRef(false)

  async function refreshCourses() {
    try {
      // Any tree newer than the one shown lands, even with a newer fetch in flight: a notify stream
      // would otherwise drop every answer until it pauses.
      const c = await newest(fetchTree())
      // Overtaken, or a failure a newer fetch owns: flipping `loaded` here would expose the empty
      // tree — routes would flash "not found" before the real tree lands.
      if (!c) return
      setCourses(c)
      announcePdfWarnings(c, warningReports, primed.current)
      primed.current = true
      setLoaded(true)
    } catch {
      // Set even on failure: an empty tree plus the central ConnectionError toast beats
      // spinning forever behind a database service that is down.
      setLoaded(true)
    }
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
    <CourseTreeContext.Provider value={{ courses: sortedCourses, loaded, refreshCourses }}>
      {children}
    </CourseTreeContext.Provider>
  )
}

export function useCourseTreeContext(): CourseTreeValue {
  const ctx = useContext(CourseTreeContext)
  if (!ctx) throw new Error('useCourseTreeContext must be used inside <CourseTreeProvider>')
  return ctx
}
