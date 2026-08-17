import { useState } from 'react'
import Icon from '@/shared/components/Icon'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import CourseGroup from './CourseGroup'
import '@/styles/sidebar-tree.css'
import './ArchivedSection.css'

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
