import { Trans } from '@lingui/react/macro'
import { useMatch, useNavigate } from 'react-router-dom'
import { ROUTES, routeParam } from '@/shared/utils/routes'
import Icon from '@/shared/components/Icon'
import { mergedRoute } from '@/shared/utils/url'
import { useCourseGroup } from './CourseGroupContext'
import '@/styles/sidebar-tree.css'
import './CourseOverviewRow.css'

// The row under a course's overview: the merged-summaries history, selected on it and on the create page.
export default function CourseMergedRow() {
  const { course } = useCourseGroup()
  const navigate = useNavigate()
  const history = useMatch(ROUTES.merged)
  const create = useMatch(ROUTES.mergedNew)
  const match = history ?? create
  const isSelected = routeParam(match?.params.course) === course.name

  return (
    <li>
      <button
        className={`lecture-btn course-merged-row${isSelected ? ' selected' : ''}`}
        onClick={() => navigate(mergedRoute(course.name))}
      >
        <span className="course-overview-icon" aria-hidden="true">
          <Icon icon="document" />
        </span>
        <span className="lecture-name">
          <Trans>Merge summaries</Trans>
        </span>
      </button>
    </li>
  )
}
