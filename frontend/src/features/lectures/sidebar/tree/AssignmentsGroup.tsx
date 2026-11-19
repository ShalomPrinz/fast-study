import Icon from '@/shared/components/Icon'
import {
  timelineClass,
  timelineCurrentIndex,
  trackProgress,
} from '@/features/lectures/utils/studyProgress'
import { Trans } from '@lingui/react/macro'
import { useMatch, useNavigate } from 'react-router-dom'
import { ROUTES, routeParam } from '@/shared/utils/routes'
import { assignmentRoute } from '@/shared/utils/url'
import { useCourseGroup } from './CourseGroupContext'
import TreeProgress from './TreeProgress'
import PlaceholderLectureItem from './PlaceholderLectureItem'
import { useCourseJobs } from '@/features/downloads/contexts/DownloadJobsContext'
import { placeholderJobs } from '@/features/downloads/utils/placeholders'
import '@/styles/sidebar-tree.css'
import './RecitationsGroup.css'

// The course's assignments, apart from its lectures whatever `lectures_only` says; with none listed
// and none downloading there is no group, since nothing adds one by hand.
export default function AssignmentsGroup() {
  const { course } = useCourseGroup()
  const navigate = useNavigate()
  const match = useMatch(ROUTES.assignment)
  const open =
    match && routeParam(match.params.course) === course.name
      ? routeParam(match.params.assignment)
      : null
  const jobs = useCourseJobs(course.name)
  const pending = placeholderJobs(jobs, course.name, course, 'assignment')

  if (!course.assignments.length && !pending.length) return null
  const progress = trackProgress(course.assignments)
  const count = course.assignments.length + pending.length
  const currentIndex = timelineCurrentIndex(course.assignments)

  return (
    <li className="recitations-group recitations-group--assignment">
      <div className="recitations-header">
        <span className="recitations-title" dir="auto">
          <Trans>Assignments</Trans>
        </span>
      </div>
      {progress.total > 0 && (
        <div className="course-head-sub">
          <Trans>
            {progress.done} of {progress.total} studied
          </Trans>
        </div>
      )}
      <TreeProgress kind="assignment" done={progress.done} total={progress.total} />
      <ul className="lecture-list recitation-list">
        {course.assignments.map((a, i) => (
          <li key={a.name} className={timelineClass(i, count, currentIndex)}>
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
                {a.done ? <Icon icon="check" /> : null}
              </span>
              <span className="lecture-name" dir="auto">
                {a.name}
              </span>
            </button>
          </li>
        ))}
        {pending.map((job, i) => (
          <PlaceholderLectureItem
            key={job.lecture}
            job={job}
            timeline={timelineClass(course.assignments.length + i, count, currentIndex)}
          />
        ))}
      </ul>
    </li>
  )
}
