import { useEffect } from 'react'
import { useLingui } from '@lingui/react/macro'
import { useParams } from 'react-router-dom'
import { useReportOnce } from '@/shared/hooks/useReportOnce'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { courseNotFound } from '@/shared/utils/notFound'
import NotFoundPanel from '@/shared/components/NotFoundPanel'
import { toast } from '@/services/toaster'
import {
  CourseOverviewProvider,
  useCourseOverview,
} from '@/features/course-overview/contexts/CourseOverviewContext'
import GenerateAllButton from '@/features/course-overview/components/GenerateAllButton'
import ExtractorRow from '@/features/course-overview/components/ExtractorRow'
import '@/styles/spinner.css'
import '@/styles/panel.css'
import '@/styles/file-row.css'

function CourseOverviewBody() {
  const { t } = useLingui()
  const { course, extractors, status } = useCourseOverview()
  const { report: reportError, prune: pruneErrors } = useReportOnce((msg) => toast('error', msg))

  // Toast each extractor error once per (course, slug, message).
  useEffect(() => {
    if (!status) return
    const titleBySlug = new Map(extractors?.map((e) => [e.slug, e.title]))
    const valid = new Set<string>()
    for (const [slug, st] of Object.entries(status.extractors)) {
      if (st.status !== 'error') continue
      const key = `${course}/${slug}`
      valid.add(key)
      const title = titleBySlug.get(slug) ?? slug
      reportError(key, `${title}: ${st.message ?? t`failed`}`)
    }
    // Prune only this course's keys, or returning to another course would re-toast its errors.
    pruneErrors(valid, (k) => k.startsWith(`${course}/`))
  }, [status, course, extractors])

  return (
    <main className="main-view main-view--panel">
      <div className="lecture-panel">
        <h2 className="lecture-panel-title" dir="auto">
          {course}
        </h2>

        <GenerateAllButton />

        {extractors === null ? (
          <div className="spinner" />
        ) : (
          <div className="file-list">
            {extractors.map((e) => (
              <ExtractorRow key={e.slug} extractor={e} />
            ))}
          </div>
        )}
      </div>
    </main>
  )
}

export default function CourseView() {
  const { course = '' } = useParams()
  const { courses, loaded } = useCourseTreeContext()

  if (!course) return null

  if (!loaded) {
    return (
      <main className="main-view">
        <div className="spinner" />
      </main>
    )
  }

  // Guarded before the provider mounts, so a course that doesn't exist fires no overview requests.
  const missing = courseNotFound(courses, course)
  if (missing) return <NotFoundPanel message={missing} />

  return (
    <CourseOverviewProvider course={course}>
      <CourseOverviewBody />
    </CourseOverviewProvider>
  )
}
