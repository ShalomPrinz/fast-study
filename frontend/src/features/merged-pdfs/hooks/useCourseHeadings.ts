import { useEffect, useRef, useState } from 'react'
import { fetchCourseHeadings } from '@/services/database'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { useNewestRequest } from '@/shared/hooks/useLatestRequest'
import { headingsKey } from '../utils/refetchInputs'

/** The course's summary headings by `partKey`; empty until the first answer. Refetched only when `headingsKey` of the tree changes. */
export function useCourseHeadings(course: string): Record<string, string> {
  const [headings, setHeadings] = useState<Record<string, string>>({})
  const newest = useNewestRequest()
  const shown = useRef(course)
  const { courses } = useCourseTreeContext()
  const key = headingsKey(courses.find((c) => c.name === course))

  useEffect(() => {
    if (shown.current !== course) setHeadings({})
    shown.current = course
    void (async () => {
      try {
        const next = await newest(fetchCourseHeadings(course))
        if (next && course === shown.current) setHeadings(next)
      } catch {
        // The http client already toasted it; the last headings stay.
      }
    })()
  }, [course, key])

  return headings
}
