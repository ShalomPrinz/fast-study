import type { Course } from '@/types'
import { useAddLecture } from '@/features/lectures/hooks/useAddLecture'
import { CourseGroupContext } from './CourseGroupContext'
import { LectureListProvider } from './LectureListContext'
import CourseHeader from './CourseHeader'
import CourseOverviewRow from './CourseOverviewRow'
import CourseMergedRow from './CourseMergedRow'
import LectureList from './LectureList'
import AddLectureInput from './AddLectureInput'
import RecitationsGroup from './RecitationsGroup'
import AssignmentsGroup from './AssignmentsGroup'
import '@/styles/sidebar-tree.css'
import './CourseGroup.css'

export default function CourseGroup({
  course,
  onRenamed,
  onSwitch,
}: {
  course: Course
  onRenamed: (from: string, to: string) => void
  onSwitch: () => void
}) {
  const add = useAddLecture(course)

  return (
    <CourseGroupContext.Provider value={{ course, add, onRenamed }}>
      <div className="course-group">
        <CourseHeader onSwitch={onSwitch} />

        <ul className="lecture-list">
          <CourseOverviewRow />
          <CourseMergedRow />
          <LectureListProvider kind="lecture">
            <LectureList />
            <AddLectureInput />
          </LectureListProvider>

          {/* A lectures-only course lists its recitations among the lectures above. */}
          {!course.lectures_only && <RecitationsGroup />}

          <AssignmentsGroup />
        </ul>
      </div>
    </CourseGroupContext.Provider>
  )
}
