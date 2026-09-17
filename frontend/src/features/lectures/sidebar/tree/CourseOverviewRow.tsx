import { Trans } from '@lingui/react/macro'
import { useMatch, useNavigate } from 'react-router-dom'
import Icon from '@/shared/components/Icon'
import { courseRoute } from '@/shared/utils/url'
import { useCourseGroup } from './CourseGroupContext'
import '@/styles/sidebar-tree.css'
import './CourseOverviewRow.css'

// The first row of an expanded course: its overview page, selected while that page is open.
export default function CourseOverviewRow() {
  const { course } = useCourseGroup()
  const navigate = useNavigate()
  const isSelected = useMatch('/course/:course/overview')?.params.course === course.name

  return (
    <li>
      <button
        className={`lecture-btn course-overview-row${isSelected ? ' selected' : ''}`}
        onClick={() => navigate(courseRoute(course.name))}
      >
        <span className="course-overview-icon" aria-hidden="true">
          <Icon icon="overview" />
        </span>
        <span className="lecture-name">
          <Trans>Overview</Trans>
        </span>
      </button>
    </li>
  )
}
