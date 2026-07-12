import { createContext, useContext, useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import type { OverviewExtractor, CourseFile, CourseStatus, CoursePhase, OverviewMeta, RunInitResult } from '@/types'
import { fetchOverviewExtractors, fetchCourseStatus, runOverview } from '@/services/backend'
import { fetchCourseFiles, fetchCourseMeta } from '@/services/database'
import { useNotify } from '@/shared/hooks/useNotify'
import { useLatestRequest } from '@/shared/hooks/useLatestRequest'

// Data-only store for one course's overview
export interface CourseOverviewValue {
  course: string
  extractors: OverviewExtractor[] | null
  files: CourseFile[]
  meta: OverviewMeta
  status: CourseStatus | null
  generate: (names?: string[], fromPhase?: CoursePhase, skipExisting?: boolean) => Promise<RunInitResult>
}

const CourseOverviewContext = createContext<CourseOverviewValue | null>(null)

export function useCourseOverview(): CourseOverviewValue {
  const ctx = useContext(CourseOverviewContext)
  if (!ctx) throw new Error('useCourseOverview must be used within a <CourseOverviewProvider>')
  return ctx
}

export function CourseOverviewProvider({ course, children }: { course: string; children: ReactNode }) {
  const [extractors, setExtractors] = useState<OverviewExtractor[] | null>(null)
  const [files, setFiles] = useState<CourseFile[]>([])
  const [meta, setMeta] = useState<OverviewMeta>({})
  const [status, setStatus] = useState<CourseStatus | null>(null)
  const latestFiles = useLatestRequest()
  const latestMeta = useLatestRequest()
  const latestStatus = useLatestRequest()

  useEffect(() => {
    fetchOverviewExtractors()
      .then(setExtractors)
      .catch(() => {}) // connection errors are toasted centrally by the http client
  }, [])

  async function refresh() {
    try {
      const [f, m, s] = await Promise.all([
        latestFiles(fetchCourseFiles(course)),
        latestMeta(fetchCourseMeta(course)),
        latestStatus(fetchCourseStatus(course)),
      ])
      if (f) setFiles(f)
      if (m) setMeta(m)
      if (s) setStatus(s)
    } catch {
      // connection errors are toasted centrally; SSE fires again on the next transition
    }
  }

  useEffect(() => {
    setFiles([])
    setMeta({})
    setStatus(null)
    refresh()
  }, [course])

  // Refresh status and files on each backend notify event
  useNotify(refresh)

  // A single trigger runs the phases sequentially server-side; omitting names = all.
  // skipExisting continues a run (missing phases only); default overwrites (re-generate).
  async function generate(names?: string[], fromPhase?: CoursePhase, skipExisting?: boolean): Promise<RunInitResult> {
    const result = await runOverview(course, names, fromPhase, skipExisting)
    refresh()
    return result
  }

  const value: CourseOverviewValue = { course, extractors, files, meta, status, generate }
  return <CourseOverviewContext.Provider value={value}>{children}</CourseOverviewContext.Provider>
}
