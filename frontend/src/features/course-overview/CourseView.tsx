import { Fragment, useEffect } from 'react'
import type { ReactNode } from 'react'
import { Plural, Trans, useLingui } from '@lingui/react/macro'
import { useParams } from 'react-router-dom'
import { useReportOnce } from '@/shared/hooks/useReportOnce'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { courseNotFound } from '@/shared/utils/notFound'
import { isLectureComplete } from '@/features/lectures/utils/lectureProgress'
import NotFoundPanel from '@/shared/components/NotFoundPanel'
import PageHeader, { PageHeaderDot } from '@/shared/components/PageHeader'
import { toast } from '@/services/toaster'
import {
  CourseOverviewProvider,
  useCourseOverview,
} from '@/features/course-overview/contexts/CourseOverviewContext'
import { branchStatus } from '@/features/course-overview/constants/overview'
import GenerateAllButton from '@/features/course-overview/components/GenerateAllButton'
import ExtractorRow from '@/features/course-overview/components/ExtractorRow'
import '@/styles/spinner.css'
import '@/styles/panel.css'
import '@/styles/pipeline-card.css'

function CourseOverviewBody() {
  const { t } = useLingui()
  const { course, extractors, files, status } = useCourseOverview()
  const { courses } = useCourseTreeContext()
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

  const treeEntry = courses.find((c) => c.name === course)
  const lectures = treeEntry?.lectures ?? []
  const recitations = treeEntry?.recitations ?? []
  const processed = [...lectures, ...recitations].filter(isLectureComplete).length

  // Several slugs can run at once; the header names the first, the rows carry the rest.
  const runningSlug = Object.entries(status?.extractors ?? {}).find(
    ([, st]) => st.status === 'running',
  )?.[0]
  const runningTitle = extractors?.find((e) => e.slug === runningSlug)?.title
  const generated = (extractors ?? []).filter(
    (e) => branchStatus(status, files, e.slug, e.phases).done,
  ).length

  const metaItems: ReactNode[] = [
    runningTitle ? (
      <span className="page-header-state page-header-state--running">
        <span className="page-header-state-dot" />
        {t`Generating · ${runningTitle}`}
      </span>
    ) : null,
    <span>
      <Plural value={lectures.length} one="# lecture" other="# lectures" />
    </span>,
    <span>
      <Plural value={recitations.length} one="# recitation" other="# recitations" />
    </span>,
    <span>{t`${processed} fully processed`}</span>,
  ].filter((item) => item !== null)

  return (
    <main className="main-view main-view--page">
      <PageHeader
        title={course}
        meta={metaItems.map((item, i) => (
          <Fragment key={i}>
            {i > 0 && <PageHeaderDot />}
            {item}
          </Fragment>
        ))}
        actions={<GenerateAllButton />}
      />

      <div className="page-body">
        <div className="page-column">
          <div className="section-head">
            <h2 className="section-title">
              <Trans>Course overview</Trans>
            </h2>
            {extractors && (
              <span className="section-count">{t`${generated} of ${extractors.length} generated`}</span>
            )}
          </div>

          {extractors === null ? (
            <div className="spinner" />
          ) : (
            <div className="pipeline-card">
              {extractors.map((e) => (
                <ExtractorRow key={e.slug} extractor={e} />
              ))}
            </div>
          )}
        </div>
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
