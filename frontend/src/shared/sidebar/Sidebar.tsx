import { useLingui } from '@lingui/react/macro'
import { Link } from 'react-router-dom'
import type { AppMode } from '@/types'
import Icon from '@/shared/components/Icon'
import ModeToggle from '@/shared/components/ModeToggle'
import type { ModeConfig } from '@/shared/components/ModeToggle'
import CoursesList from '@/features/course-overview/CoursesList'
import LecturesSidebar from '@/features/lectures/sidebar/LecturesSidebar'
import LanguageSwitcher from './LanguageSwitcher'
import './Sidebar.css'

export default function Sidebar() {
  const { t } = useLingui()

  // Order matters: it drives the ModeToggle segment order and its default (lectures).
  const modes: Record<AppMode, ModeConfig> = {
    lectures: { label: t`Lectures`, Component: LecturesSidebar },
    courses: { label: t`Courses`, Component: CoursesList },
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        {/* The product name is a brand, not copy — it reads the same in every locale. */}
        <span>Fast Study</span>
        <div className="sidebar-header-actions">
          <Link className="sidebar-downloads-link" to="/search" title={t`Search`}>
            <Icon icon="search" />
          </Link>
          <Link className="sidebar-downloads-link" to="/downloads" title={t`Downloads`}>
            ⭳
          </Link>
        </div>
      </div>
      <ModeToggle modes={modes} storageKey="fastStudyMode" />
      <div className="sidebar-footer">
        <LanguageSwitcher />
      </div>
    </aside>
  )
}
