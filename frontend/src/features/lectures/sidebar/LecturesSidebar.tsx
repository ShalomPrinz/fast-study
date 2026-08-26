import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { PendingUploadProvider } from './PendingUploadModal'
import RunnerPipelineRow from './RunnerPipelineRow'
import CourseGroup from './tree/CourseGroup'
import ArchivedSection from './tree/ArchivedSection'
import '@/styles/sidebar-tree.css'

export default function LecturesSidebar() {
  return (
    <PendingUploadProvider>
      <LecturesSidebarBody />
    </PendingUploadProvider>
  )
}

function LecturesSidebarBody() {
  const { courses } = useCourseTreeContext()
  const active = courses.filter((c) => !c.archived)

  return (
    <>
      <RunnerPipelineRow />
      <nav className="sidebar-nav">
        {active.map((c) => (
          <CourseGroup key={c.name} course={c} />
        ))}
      </nav>
      <ArchivedSection />
    </>
  )
}
