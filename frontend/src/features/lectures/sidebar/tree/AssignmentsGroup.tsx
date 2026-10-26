import Tooltip from '@/shared/components/Tooltip'
import Icon from '@/shared/components/Icon'
import { trackProgress } from '@/features/lectures/utils/studyProgress'
import { Trans, useLingui } from '@lingui/react/macro'
import { useMatch, useNavigate } from 'react-router-dom'
import type { ExpandHandle } from '@/types'
import Chevron from '@/shared/components/Chevron'
import { ROUTES, routeParam } from '@/shared/utils/routes'
import { assignmentRoute } from '@/shared/utils/url'
import { useCourseGroup } from './CourseGroupContext'
import '@/styles/sidebar-tree.css'
import './RecitationsGroup.css'

// The course's assignments, listed apart from its lectures whatever `lectures_only` says; there is no
// way to add one by hand, so a course without any shows no group. `expand` is owned by CourseGroup.
export default function AssignmentsGroup({ expand }: { expand: ExpandHandle }) {
  const { t } = useLingui()
  const { course } = useCourseGroup()
  const navigate = useNavigate()
  const match = useMatch(ROUTES.assignment)
  const open =
    match && routeParam(match.params.course) === course.name
      ? routeParam(match.params.assignment)
      : null

  if (!course.assignments.length) return null
  const progress = trackProgress(course.assignments)

  return (
    <li className="recitations-group">
      <div className="recitations-header">
        <button className="course-toggle recitations-toggle" onClick={expand.toggle}>
          <span className="chevron">
            <Chevron open={expand.isOpen} />
          </span>
          <span dir="auto">
            <Trans>Assignments</Trans>
          </span>
          {!course.archived && (
            <Tooltip content={t`Assignments you marked done`} placement="inline-end">
              <span className="course-count">
                {progress.done}/{progress.total}
              </span>
            </Tooltip>
          )}
        </button>
      </div>
      {expand.isOpen && (
        <ul className="lecture-list recitation-list">
          {course.assignments.map((a) => (
            <li key={a.name}>
              <button
                className={`lecture-btn${open === a.name ? ' selected' : ''}`}
                data-testid="assignment"
                data-course={course.name}
                data-assignment={a.name}
                onClick={() => navigate(assignmentRoute(course.name, a.name))}
              >
                <span
                  className={`lecture-mark lecture-mark--${a.done ? 'done' : progress.current?.name === a.name ? 'current' : 'todo'}`}
                >
                  {a.done ? (
                    <Icon icon="check" />
                  ) : progress.current?.name === a.name ? (
                    <Icon icon="arrow-end" />
                  ) : null}
                </span>
                <span className="lecture-name" dir="auto">
                  {a.name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
