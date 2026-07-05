import type { AppMode } from '@/types'
import RefreshCoursesButton from './RefreshCoursesButton'
import ModeToggle from './ModeToggle'
import type { ModeConfig } from './ModeToggle'
import CoursesList from './CoursesList'
import LecturesSidebar from './LecturesSidebar'

// Order matters: it drives the ModeToggle segment order (Lectures then Courses).
const MODES: Record<AppMode, ModeConfig> = {
  lectures: { label: 'Lectures', Component: LecturesSidebar },
  courses: { label: 'Courses', Component: CoursesList },
}

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span>Fast Study</span>
        <RefreshCoursesButton />
      </div>
      <ModeToggle modes={MODES} />
    </aside>
  )
}
