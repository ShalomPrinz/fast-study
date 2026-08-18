import { Link } from 'react-router-dom'
import type { AppMode } from '@/types'
import Icon from '@/shared/components/Icon'
import ModeToggle from '@/shared/components/ModeToggle'
import type { ModeConfig } from '@/shared/components/ModeToggle'
import CoursesList from '@/features/course-overview/CoursesList'
import LecturesSidebar from '@/features/lectures/sidebar/LecturesSidebar'
import LanguageSwitcher from './LanguageSwitcher'
import './Sidebar.css'

// Order matters: it drives the ModeToggle segment order and its default (lectures).
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
        </div>
      </div>
      <ModeToggle modes={MODES} storageKey="fastStudyMode" />
      <div className="sidebar-footer">
        <LanguageSwitcher />
      </div>
    </aside>
  )
}
