import { Fragment, useEffect } from 'react'
import type { ReactNode } from 'react'
import { Plural, Trans, useLingui } from '@lingui/react/macro'
import { useParams } from 'react-router-dom'
import { routeParam } from '@/shared/utils/routes'
import { useReportOnce } from '@/shared/hooks/useReportOnce'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { useDriveEnabled } from '@/shared/contexts/SettingsContext'
import { courseNotFound, routeMiss } from '@/shared/utils/notFound'
import { isLectureComplete } from '@/features/lectures/utils/lectureProgress'
import { lectureTrack, recitationTrack } from '@/features/lectures/utils/courseTree'
import NotFoundPanel from '@/shared/components/NotFoundPanel'
import PageHeader, { PageHeaderDot } from '@/shared/components/PageHeader'
import { toast } from '@/services/toaster'
import { failureId, type ServiceFailure } from '@/shared/i18n/serviceErrors'
import { captureUnmappedFailure } from '@/services/sentry'
import { serviceErrorNode } from '@/shared/components/ServiceError'
import {
  CourseOverviewProvider,
  useCourseOverview,
} from '@/features/course-overview/contexts/CourseOverviewContext'
import { branchStatus, extractorTitle, isBare } from '@/features/course-overview/constants/overview'
import GenerateAllButton from '@/features/course-overview/components/GenerateAllButton'
import CurrentStudy from '@/features/course-overview/components/CurrentStudy'
import ExtractorRow from '@/features/course-overview/components/ExtractorRow'
import '@/styles/spinner.css'
import '@/styles/panel.css'
import '@/styles/pipeline-card.css'

function CourseOverviewBody() {
  const { t } = useLingui()
  const { course, extractors, files, status } = useCourseOverview()
  const { courses } = useCourseTreeContext()
  const driveEnabled = useDriveEnabled()
  // Reporting rides the send, so only a failure that actually toasts (past the repeat-removal) is reported.
  const { report: reportError, prune: pruneErrors } = useReportOnce<{
    node: ReactNode
    failure: ServiceFailure | null
  }>(({ node, failure }) => {
    if (failure) captureUnmappedFailure(failure)
    toast('error', node)
  })

  // Toast each extractor error once per (course, slug, failure).
  useEffect(() => {
    if (!status) return
    const titleBySlug = new Map(extractors?.map((e) => [e.slug, extractorTitle(e)]))
    const valid = new Set<string>()
    for (const [slug, st] of Object.entries(status.extractors)) {
      if (st.status !== 'error') continue
      const key = `${course}/${slug}`
      valid.add(key)
      const failure = { message: st.message ?? '', code: st.code, params: st.params }
      const title = titleBySlug.get(slug) ?? slug
      // The branch's own name leads, so a course generating several says which one failed. A bare
      // failure shows just the translated word and is not reported: nothing diagnostic in it.
      const bare = isBare(st)
      reportError(key, `${title}|${failureId(failure)}`, {
        node: serviceErrorNode(failure, title, bare ? t`failed` : undefined, false),
        failure: bare ? null : failure,
      })
    }
    // Prune only this course's keys, or returning to another course would re-toast its errors.
    pruneErrors(valid, (k) => k.startsWith(`${course}/`))
  }, [status, course, extractors])

  const treeEntry = courses.find((c) => c.name === course)
  // A lectures-only course counts and studies its recitations as lectures, in the sidebar's order.
  const lectures = treeEntry ? lectureTrack(treeEntry) : []
  const recitations = treeEntry && !treeEntry.lectures_only ? recitationTrack(treeEntry) : null
  const processed = [...lectures, ...(recitations ?? [])].filter((l) =>
    isLectureComplete(l, driveEnabled),
  ).length

  // Several slugs can run at once; the header names the first, the rows carry the rest.
  const runningSlug = Object.entries(status?.extractors ?? {}).find(
    ([, st]) => st.status === 'running',
  )?.[0]
  const runningExtractor = extractors?.find((e) => e.slug === runningSlug)
  const runningTitle = runningExtractor ? extractorTitle(runningExtractor) : undefined
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
    recitations ? (
      <span>
        <Plural value={recitations.length} one="# recitation" other="# recitations" />
      </span>
    ) : null,
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
          <CurrentStudy course={course} lectures={lectures} recitations={recitations} />

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
  const course = routeParam(useParams().course)
  const { courses, loaded, loadFailed } = useCourseTreeContext()

  if (!course) return null

  if (!loaded) {
    return (
      <main className="main-view">
        <div className="spinner" />
      </main>
    )
  }

  // Guarded before the provider mounts, so a course that doesn't exist fires no overview requests.
  const miss = routeMiss(courseNotFound(courses, course), loadFailed)
  if (miss) return <NotFoundPanel {...miss} />

  return (
    <CourseOverviewProvider course={course}>
      <CourseOverviewBody />
    </CourseOverviewProvider>
  )
}
