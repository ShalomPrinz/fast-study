import { useLayoutEffect, useRef } from 'react'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { PendingUploadProvider } from './PendingUploadModal'
import NewCourseRow from './NewCourseRow'
import CourseGroup from './tree/CourseGroup'
import ArchivedSection from './tree/ArchivedSection'
import '@/styles/sidebar-tree.css'
import './LecturesTreePane.css'

// Saved on every scroll rather than on unmount, where the detached nav already reads 0.
let savedScrollTop = 0

export default function LecturesTreePane() {
  return (
    <PendingUploadProvider>
      <LecturesTreePaneBody />
    </PendingUploadProvider>
  )
}

function LecturesTreePaneBody() {
  const { courses } = useCourseTreeContext()
  const active = courses.filter((c) => !c.archived)
  const navRef = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    if (navRef.current) navRef.current.scrollTop = savedScrollTop
  }, [])

  return (
    <aside className="tree-pane">
      <nav
        className="sidebar-nav"
        ref={navRef}
        onScroll={(e) => {
          savedScrollTop = e.currentTarget.scrollTop
        }}
      >
        {active.map((c) => (
          <CourseGroup key={c.name} course={c} />
        ))}
      </nav>
      <ArchivedSection />
      <div className="tree-pane-footer">
        <NewCourseRow />
      </div>
    </aside>
  )
}
