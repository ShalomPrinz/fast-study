import { Plural, Trans, useLingui } from '@lingui/react/macro'
import { useParams } from 'react-router-dom'
import Tooltip from '@/shared/components/Tooltip'
import Icon from '@/shared/components/Icon'
import NotFoundPanel from '@/shared/components/NotFoundPanel'
import PageHeader from '@/shared/components/PageHeader'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { assignmentNotFound, routeMiss } from '@/shared/utils/notFound'
import { formatBytes } from '@/shared/utils/format'
import { routeParam } from '@/shared/utils/routes'
import {
  canOpenWith,
  canReveal,
  openAssignmentFile,
  openAssignmentFileWith,
  revealAssignmentFile,
} from '@/services/open'
import { MaterialNameButton } from './components/MaterialChip'
import OpenWithMenu from './components/OpenWithMenu'
import '@/styles/button.css'
import '@/styles/panel.css'
import './components/MaterialChip.css'
import './AssignmentView.css'

// A course assignment's files: each opens in the OS default app, with "Open with…" on Windows
// packaged and "Show in folder" wherever the desktop app is. Nothing here edits or deletes.
export default function AssignmentView() {
  const { t } = useLingui()
  const params = useParams<{ course: string; assignment: string }>()
  const course = routeParam(params.course)
  const assignment = routeParam(params.assignment)
  const { courses, loadFailed } = useCourseTreeContext()

  const miss = routeMiss(assignmentNotFound(courses, course, assignment), loadFailed)
  if (miss) return <NotFoundPanel {...miss} />
  const files = courses
    .find((c) => c.name === course)
    ?.assignments.find((a) => a.name === assignment)?.files
  if (!files) return null

  const reveal = canReveal()
  return (
    <main
      className="main-view main-view--page"
      data-testid="assignment-view"
      data-course={course}
      data-assignment={assignment}
    >
      <PageHeader
        eyebrow={course}
        title={assignment}
        meta={
          <span>
            <Plural value={files.length} one="# file" other="# files" />
          </span>
        }
      />
      <div className="page-body">
        <div className="page-column">
          <ul className="assignment-files">
            {files.map((f) => (
              <li key={f.name} className="assignment-file" data-testid="assignment-file">
                <Icon icon="file" />
                <MaterialNameButton
                  label={f.name}
                  hint={t`Open file`}
                  onOpen={() => openAssignmentFile(course, assignment, f.name)}
                />
                <span className="assignment-file-size">{formatBytes(f.size)}</span>
                {canOpenWith() && (
                  <OpenWithMenu
                    onOpenWith={() => openAssignmentFileWith(course, assignment, f.name)}
                  />
                )}
                <Tooltip content={reveal ? undefined : t`Needs the desktop app`}>
                  <button
                    className="btn btn--ghost assignment-file-reveal"
                    disabled={!reveal}
                    onClick={() => revealAssignmentFile(course, assignment, f.name)}
                  >
                    <Icon icon="folder" />
                    <Trans>Show in folder</Trans>
                  </button>
                </Tooltip>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  )
}
