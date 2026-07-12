import { useState, useEffect, useRef } from 'react'
import type { Course } from '@/types'
import { useSelection } from '@/features/lectures/hooks/useSelection'
import { useAddLecture } from '@/features/lectures/hooks/useAddLecture'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { CourseGroupContext } from './CourseGroupContext'
import { LectureListProvider } from './LectureListContext'
import CourseHeader from './CourseHeader'
import LectureList from './LectureList'
import AddLectureInput from './AddLectureInput'
import RecitationsGroup from './RecitationsGroup'

export default function CourseGroup({ course }: { course: Course }) {
  const { selected } = useSelection()
  const { refreshCourses } = useCourseTreeContext()
  const add = useAddLecture(course)

  const [expanded, setExpanded] = useState(false)
  const [recExpanded, setRecExpanded] = useState(false)
  const didAutoExpandRef = useRef(false)

  // Auto-expand this group the first time it becomes the selected course (e.g. deep link).
  useEffect(() => {
    if (didAutoExpandRef.current) return
    if (selected?.course !== course.name) return
    didAutoExpandRef.current = true
    setExpanded(true)
    if (selected.kind === 'recitation') setRecExpanded(true)
  }, [selected, course.name])

  function toggleCourse() {
    setExpanded((v) => !v)
    refreshCourses()
  }

  return (
    <CourseGroupContext.Provider value={{ course, add }}>
      <div className="course-group">
        <CourseHeader
          expand={{ isOpen: expanded, toggle: toggleCourse, open: () => setExpanded(true) }}
        />

        {expanded && (
          <ul className="lecture-list">
            <LectureListProvider kind="lecture">
              <LectureList />
              <AddLectureInput />
            </LectureListProvider>

            <RecitationsGroup
              expand={{
                isOpen: recExpanded,
                toggle: () => setRecExpanded((v) => !v),
                open: () => setRecExpanded(true),
              }}
            />
          </ul>
        )}
      </div>
    </CourseGroupContext.Provider>
  )
}
