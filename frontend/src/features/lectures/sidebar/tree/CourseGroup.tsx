import { useState } from 'react'
import type { Course } from '@/types'
import { useAddLecture } from '@/features/lectures/hooks/useAddLecture'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { CourseGroupContext } from './CourseGroupContext'
import { LectureListProvider } from './LectureListContext'
import CourseHeader from './CourseHeader'
import CourseOverviewRow from './CourseOverviewRow'
import LectureList from './LectureList'
import AddLectureInput from './AddLectureInput'
import RecitationsGroup from './RecitationsGroup'
import AssignmentsGroup from './AssignmentsGroup'
import '@/styles/sidebar-tree.css'
import './CourseGroup.css'

export default function CourseGroup({
  course,
  onRenamed,
}: {
  course: Course
  onRenamed: (from: string, to: string) => void
}) {
  const { refreshCourses } = useCourseTreeContext()
  const add = useAddLecture(course)

  // The tree remounts this group on every swap, so a collapse lasts only while the course stays open.
  const [expanded, setExpanded] = useState(true)

  function toggleCourse() {
    setExpanded((v) => !v)
    refreshCourses()
  }

  return (
    <CourseGroupContext.Provider value={{ course, add, onRenamed }}>
      <div className="course-group">
        <CourseHeader
          expand={{ isOpen: expanded, toggle: toggleCourse, open: () => setExpanded(true) }}
        />

        {expanded && (
          <ul className="lecture-list">
            <CourseOverviewRow />
            <LectureListProvider kind="lecture">
              <LectureList />
              <AddLectureInput />
            </LectureListProvider>

            {/* A lectures-only course lists its recitations among the lectures above. */}
            {!course.lectures_only && <RecitationsGroup />}

            <AssignmentsGroup />
          </ul>
        )}
      </div>
    </CourseGroupContext.Provider>
  )
}
