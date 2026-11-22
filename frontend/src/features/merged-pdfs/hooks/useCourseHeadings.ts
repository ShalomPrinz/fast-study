import { useEffect, useRef, useState } from 'react'
import { fetchCourseHeadings } from '@/services/database'
import { useNotify } from '@/shared/hooks/useNotify'
import { useNewestRequest } from '@/shared/hooks/useLatestRequest'

/** The course's summary headings by `partKey`; empty until the first answer. Refetched on each SSE notify, which the database pings on a summary write. */
export function useCourseHeadings(course: string): Record<string, string> {
  const [headings, setHeadings] = useState<Record<string, string>>({})
  const newest = useNewestRequest()
  const shown = useRef(course)

  async function refresh() {
    try {
      const next = await newest(fetchCourseHeadings(course))
      if (next && course === shown.current) setHeadings(next)
    } catch {
      // The http client already toasted it; the last headings stay.
    }
  }

  useEffect(() => {
    shown.current = course
    setHeadings({})
    void refresh()
  }, [course])

  useNotify(refresh)
  return headings
}
