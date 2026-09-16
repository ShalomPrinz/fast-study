import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { PendingUploadProvider } from './PendingUploadModal'
import NewCourseRow from './NewCourseRow'
import CourseGroup from './tree/CourseGroup'
import ArchivedSection from './tree/ArchivedSection'
import '@/styles/sidebar-tree.css'
import './LecturesTreePane.css'

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

  return (
    <aside className="tree-pane">
      <nav className="sidebar-nav">
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
