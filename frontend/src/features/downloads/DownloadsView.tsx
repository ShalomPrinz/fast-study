import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import AuthPill from './AuthPill'
import CourseSourceRow from './CourseSourceRow'
import AddCourseRow from './AddCourseRow'

// Downloads page: connect BIU account and manage courses downloads via course's source URLs
export default function DownloadsView() {
  const { courses } = useCourseTreeContext()
  const active = courses.filter((c) => !c.archived)

  return (
    <main className="main-view main-view--panel">
      <div className="lecture-panel">
        <h2 className="lecture-panel-title">Downloads</h2>

        <AuthPill />

        <div className="source-list">
          {active.map((course) => (
            <CourseSourceRow key={course.name} course={course} />
          ))}
          <AddCourseRow />
        </div>
      </div>
    </main>
  )
}
