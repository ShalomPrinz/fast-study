import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useReportOnce } from '@/shared/hooks/useReportOnce'
import { toast } from '@/services/toaster'
import { CourseOverviewProvider, useCourseOverview } from '@/features/course-overview/contexts/CourseOverviewContext'
import GenerateAllButton from '@/features/course-overview/components/GenerateAllButton'
import ExtractorRow from '@/features/course-overview/components/ExtractorRow'

function CourseOverviewBody() {
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
      reportError(key, `${titleBySlug.get(slug) ?? slug}: ${st.message ?? 'failed'}`)
    }
    // Prune only this course's keys, or returning to another course would re-toast its errors.
    pruneErrors(valid, (k) => k.startsWith(`${course}/`))
  }, [status, course, extractors])

  return (
    <main className="main-view main-view--panel">
      <div className="lecture-panel">
        <h2 className="lecture-panel-title" dir="auto">{course}</h2>

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
  if (!course) return null
  return (
    <CourseOverviewProvider course={course}>
      <CourseOverviewBody />
    </CourseOverviewProvider>
  )
}
