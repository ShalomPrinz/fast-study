import { useState } from 'react'
import Icon from '@/components/Icon'
import { useCourseTreeContext } from '@/contexts/CourseTreeContext'
import CourseGroup from './CourseGroup'

// The archived-courses footer toggle + its collapsible panel of archived CourseGroups.
export default function ArchivedSection() {
  const { courses } = useCourseTreeContext()
  const [showArchived, setShowArchived] = useState(false)

  const archived = courses.filter((c) => c.archived)

  return (
    <>
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
