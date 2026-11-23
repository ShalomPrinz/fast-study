import { Plural, Trans, useLingui } from '@lingui/react/macro'
import { Link, useParams } from 'react-router-dom'
import { routeParam } from '@/shared/utils/routes'
import { courseNotFound, routeMiss } from '@/shared/utils/notFound'
import { mergedNewRoute } from '@/shared/utils/url'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { useRunnerStatus } from '@/shared/contexts/RunnerStatusContext'
import EmptyCard from '@/shared/components/EmptyCard'
import NotFoundPanel from '@/shared/components/NotFoundPanel'
import PageHeader from '@/shared/components/PageHeader'
import MergedRowView from './components/MergedRow'
import { useMergedPdfs } from './hooks/useMergedPdfs'
import { mergedRows } from './utils/mergedRows'
import '@/styles/spinner.css'
import '@/styles/panel.css'
import '@/styles/button.css'
import '@/styles/pipeline-card.css'
import './MergedPdfsView.css'

function MergedPdfsBody({ course }: { course: string }) {
  const { t } = useLingui()
  const { status } = useRunnerStatus()
  const items = useMergedPdfs(course)
  const rows = items ? mergedRows(course, items, status) : []

  return (
    <main className="main-view main-view--page">
      <PageHeader
        eyebrow={course}
        title={t`Merged summaries`}
        meta={
          items && rows.length > 0 ? (
            <span>
              <Plural value={rows.length} one="# merged PDF" other="# merged PDFs" />
            </span>
          ) : undefined
        }
      />
      <div className="page-body">
        <div className="page-column">
          <div className="merged-history-create">
            <Link className="btn btn--primary merged-create-link" to={mergedNewRoute(course)}>
              <Trans>Create new</Trans>
            </Link>
          </div>
          {items === null ? (
            <div className="spinner" />
          ) : rows.length === 0 ? (
            <div className="merged-empty">
              <EmptyCard icon="document">
                <Trans>You haven't created any merged summaries yet</Trans>
              </EmptyCard>
            </div>
          ) : (
            <div className="pipeline-card merged-list">
              {rows.map((row) => (
                <MergedRowView key={row.name} course={course} row={row} />
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

// The course's merged PDFs, newest first, each with the state of any run on it.
export default function MergedPdfsView() {
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
  const miss = routeMiss(courseNotFound(courses, course), loadFailed)
  if (miss) return <NotFoundPanel {...miss} />
  return <MergedPdfsBody course={course} />
}
