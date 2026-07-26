import { useEffect, useRef, useState } from 'react'
import type { CourseSummary } from '@/types'
import { fetchCourseSummaries } from '@/services/database'

// The selected course's whole summary corpus, fetched once per course and kept in memory for the
// session. Never invalidated — an edited summary stays stale until the page is revisited.
export function useCourseSummaries(course: string | null) {
  const cache = useRef(new Map<string, CourseSummary[]>())
  const [summaries, setSummaries] = useState<CourseSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!course) {
      setSummaries([])
      return
    }
    const cached = cache.current.get(course)
    if (cached) {
      setSummaries(cached)
      setError(null)
      return
    }
    let current = true
    setSummaries([])
    setError(null)
    setLoading(true)
    fetchCourseSummaries(course)
      .then((s) => {
        cache.current.set(course, s)
        if (current) setSummaries(s)
      })
      .catch(() => {
        if (current) setError(`Couldn't load summaries for ${course}.`)
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [course])

  return { summaries, loading, error }
}
