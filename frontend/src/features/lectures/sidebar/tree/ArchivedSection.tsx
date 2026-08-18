import { useState } from 'react'
import { Trans } from '@lingui/react/macro'
import Icon from '@/shared/components/Icon'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import CourseGroup from './CourseGroup'
import '@/styles/sidebar-tree.css'
import './ArchivedSection.css'

export default function ArchivedSection() {
  const { courses } = useCourseTreeContext()
  const [showArchived, setShowArchived] = useState(false)

  const archived = courses.filter((c) => c.archived)
  const archivedCount = archived.length

  return (
    <>
      <button
        className={`archived-footer-btn${showArchived ? ' active' : ''}`}
        onClick={() => setShowArchived((v) => !v)}
      >
        <Icon icon="archive-box" />
        <span>
          <Trans>Archived ({archivedCount})</Trans>
        </span>
      </button>

      {showArchived && (
        <nav className="sidebar-nav archived-panel">
          {archived.length === 0 ? (
            <div className="archived-empty">
              <Trans>No archived courses</Trans>
            </div>
          ) : (
            archived.map((c) => <CourseGroup key={c.name} course={c} />)
          )}
        </nav>
      )}
    </>
  )
}
