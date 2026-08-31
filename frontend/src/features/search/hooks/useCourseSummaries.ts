import { useEffect, useRef, useState } from 'react'
import { t } from '@lingui/core/macro'
import type { CourseSummary } from '@/types'
import { fetchCourseSummaries } from '@/services/database'

// One object rather than three `useState`s: results and the loading flag must land in the same
// render, or the frame between them shows the loading line above the new results.
interface State {
  summaries: CourseSummary[]
  loading: boolean
  error: string | null
}

const IDLE: State = { summaries: [], loading: false, error: null }

// The selected course's whole summary corpus, fetched once per course and kept in memory for the
// session. Never invalidated — an edited summary stays stale until the page is revisited.
export function useCourseSummaries(course: string | null) {
  const cache = useRef(new Map<string, CourseSummary[]>())
  const [state, setState] = useState<State>(IDLE)

  useEffect(() => {
    if (!course) {
      setState(IDLE)
      return
    }
    const cached = cache.current.get(course)
    if (cached) {
      setState({ summaries: cached, loading: false, error: null })
      return
    }
    let current = true
    setState({ summaries: [], loading: true, error: null })
    fetchCourseSummaries(course)
      .then((s) => {
        cache.current.set(course, s)
        if (current) setState({ summaries: s, loading: false, error: null })
      })
      .catch(() => {
        if (current)
          setState({
            summaries: [],
            loading: false,
            error: t`Couldn't load summaries for ${course}.`,
          })
      })
    return () => {
      current = false
    }
  }, [course])

  return state
}
