import { useLayoutEffect, useRef } from 'react'
import { Trans } from '@lingui/react/macro'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { courseLoadNotice } from '@/shared/utils/courseLoadNotice'
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
  const { courses, loaded, loadFailed } = useCourseTreeContext()
  const active = courses.filter((c) => !c.archived)
  const notice = courseLoadNotice(courses, loaded, loadFailed)
  const navRef = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    if (navRef.current) navRef.current.scrollTop = savedScrollTop
  }, [])

  return (
    <aside className="tree-pane">
      <nav
        className={notice ? 'sidebar-nav sidebar-nav--empty' : 'sidebar-nav'}
        ref={navRef}
        onScroll={(e) => {
          savedScrollTop = e.currentTarget.scrollTop
        }}
      >
        {notice === 'failed' ? (
          <p className="tree-pane-empty tree-pane-empty--failed">
            <Trans>Courses failed to load.</Trans>
          </p>
        ) : notice === 'no-courses' ? (
          <p className="tree-pane-empty">
            <Trans>No lectures yet. Add one from Downloads, or add a course manually.</Trans>
          </p>
        ) : (
          active.map((c) => <CourseGroup key={c.name} course={c} />)
        )}
      </nav>
      <ArchivedSection />
      <div className="tree-pane-footer">
        <NewCourseRow />
      </div>
    </aside>
  )
}
