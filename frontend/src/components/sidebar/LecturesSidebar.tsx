import { useState } from 'react'
import Icon from '@/components/Icon'
import { useCourseTreeContext } from '@/contexts/CourseTreeContext'
import NewCourseRow from './NewCourseRow'
import { PendingUploadProvider } from './PendingUploadModal'
import RunnerPipelineRow from './RunnerPipelineRow'
import CourseGroup from './tree/CourseGroup'

export default function LecturesSidebar() {
  return (
    <PendingUploadProvider>
      <LecturesSidebarBody />
    </PendingUploadProvider>
  )
}

function LecturesSidebarBody() {
  const { courses } = useCourseTreeContext()
  const [showArchived, setShowArchived] = useState(false)

  const active = courses.filter((c) => !c.archived)
  const archived = courses.filter((c) => c.archived)

  return (
    <>
      <NewCourseRow />
      <RunnerPipelineRow />
      <nav className="sidebar-nav">
        {active.map((c) => <CourseGroup key={c.name} course={c} />)}
      </nav>

      <button
        className={`archived-footer-btn${showArchived ? ' active' : ''}`}
        onClick={() => setShowArchived((v) => !v)}
      >
        <Icon icon="archive-box" />
        <span>Archived ({archived.length})</span>
      </button>

      {showArchived && (
        <nav className="sidebar-nav archived-panel">
          {archived.length === 0 ? (
            <div className="archived-empty">No archived courses</div>
          ) : (
            archived.map((c) => <CourseGroup key={c.name} course={c} />)
          )}
        </nav>
      )}
    </>
  )
}
