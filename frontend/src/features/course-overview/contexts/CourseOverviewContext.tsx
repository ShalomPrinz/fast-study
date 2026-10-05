import { createContext, useContext, useState, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type {
  OverviewExtractor,
  CourseFile,
  CourseStatus,
  CoursePhase,
  OverviewMeta,
  RunInitResult,
} from '@/types'
import { fetchOverviewExtractors, fetchCourseStatus, runOverview } from '@/services/backend'
import { fetchCourseFiles, fetchCourseMeta } from '@/services/database'
import { useNotify } from '@/shared/hooks/useNotify'
import { useNewestRequest } from '@/shared/hooks/useLatestRequest'

// Data-only store for one course's overview — consumers toast, this never does.
export interface CourseOverviewValue {
  course: string
  extractors: OverviewExtractor[] | null
  files: CourseFile[]
  meta: OverviewMeta
  status: CourseStatus | null
  generate: (
    names?: string[],
    fromPhase?: CoursePhase,
    skipExisting?: boolean,
  ) => Promise<RunInitResult>
}

const CourseOverviewContext = createContext<CourseOverviewValue | null>(null)

export function useCourseOverview(): CourseOverviewValue {
  const ctx = useContext(CourseOverviewContext)
  if (!ctx) throw new Error('useCourseOverview must be used within a <CourseOverviewProvider>')
  return ctx
}

export function CourseOverviewProvider({
  course,
  children,
}: {
  course: string
  children: ReactNode
}) {
  const [extractors, setExtractors] = useState<OverviewExtractor[] | null>(null)
  const [files, setFiles] = useState<CourseFile[]>([])
  const [meta, setMeta] = useState<OverviewMeta>({})
  const [status, setStatus] = useState<CourseStatus | null>(null)
  // Any triple newer than the one shown lands, even with a newer fetch in flight: a notify stream
  // would otherwise drop every answer until it pauses.
  const newest = useNewestRequest()
  const shownCourse = useRef(course)

  useEffect(() => {
    fetchOverviewExtractors()
      .then(setExtractors)
      .catch(() => {}) // connection errors are toasted centrally by the http client
  }, [])

  // Files, meta and status apply together, or a finished extractor's status lands beside its stale
  // files and shows "Generate" again. A side that fails alone keeps its last value; the http client toasted it.
  async function refresh() {
    const triple = await newest(
      Promise.allSettled([
        fetchCourseFiles(course),
        fetchCourseMeta(course),
        fetchCourseStatus(course),
      ]),
    )
    // Overtaken by a triple already shown, or fetched for the course before a switch.
    if (!triple || course !== shownCourse.current) return
    const [f, m, s] = triple
    if (f.status === 'fulfilled') setFiles(f.value)
    if (m.status === 'fulfilled') setMeta(m.value)
    if (s.status === 'fulfilled') setStatus(s.value)
  }

  useEffect(() => {
    shownCourse.current = course
    setFiles([])
    setMeta({})
    setStatus(null)
    refresh()
  }, [course])

  useNotify(refresh)

  // One trigger; omitting names = all slugs. skipExisting = continue (missing phases only),
  // default = overwrite. See docs/OVERVIEW.md.
  async function generate(
    names?: string[],
    fromPhase?: CoursePhase,
    skipExisting?: boolean,
  ): Promise<RunInitResult> {
    // A refused run refreshes too: the backend turned it down over state we may be showing stale.
    try {
      return await runOverview(course, names, fromPhase, skipExisting)
    } finally {
      refresh()
    }
  }

  const value: CourseOverviewValue = { course, extractors, files, meta, status, generate }
  return <CourseOverviewContext.Provider value={value}>{children}</CourseOverviewContext.Provider>
}
