import { Link } from 'react-router-dom'
import type { AppMode } from '@/types'
import Icon from '@/shared/components/Icon'
import RefreshCoursesButton from './RefreshCoursesButton'
import ModeToggle from './ModeToggle'
import type { ModeConfig } from './ModeToggle'
import CoursesList from '@/features/course-overview/CoursesList'
import LecturesSidebar from '@/features/lectures/sidebar/LecturesSidebar'

// Order matters: it drives the ModeToggle segment order.
const MODES: Record<AppMode, ModeConfig> = {
  lectures: { label: 'Lectures', Component: LecturesSidebar },
  courses: { label: 'Courses', Component: CoursesList },
}

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span>Fast Study</span>
        <div className="sidebar-header-actions">
          <Link className="sidebar-downloads-link" to="/search" title="Search">
            <Icon icon="search" />
          </Link>
          <Link className="sidebar-downloads-link" to="/downloads" title="Downloads">
            ⭳
          </Link>
          <RefreshCoursesButton />
        </div>
      </div>
      <ModeToggle modes={MODES} />
    </aside>
  )
}
