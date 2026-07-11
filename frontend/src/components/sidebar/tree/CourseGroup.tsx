import { useState, useEffect, useRef } from 'react'
import type { Course } from '@/types'
import { useSelection } from '@/hooks/useSelection'
import { useShiftHeld } from '@/hooks/useShiftHeld'
import { useAddLecture } from '@/hooks/useAddLecture'
import { useCourseTreeContext } from '@/contexts/CourseTreeContext'
import { CourseGroupContext } from './CourseGroupContext'
import { LectureListProvider } from './LectureListContext'
import CourseHeader from './CourseHeader'
import LectureList from './LectureList'
import AddLectureInput from './AddLectureInput'

export default function CourseGroup({ course }: { course: Course }) {
  const { selected } = useSelection()
  const { refreshCourses } = useCourseTreeContext()
  const shiftHeld = useShiftHeld()
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

  function startAddingRecitation(e: React.MouseEvent) {
    e.stopPropagation()
    setExpanded(true)
    setRecExpanded(true)
    add.start('recitation')
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

            <li className="recitations-group">
              <div className="recitations-header">
                <button
                  className="course-toggle recitations-toggle"
                  onClick={() => setRecExpanded((v) => !v)}
                  dir="auto"
                >
                  <span className="chevron">{recExpanded ? '▾' : '▸'}</span>
                  <span>Recitations</span>
                </button>
                {!shiftHeld && (
                  <button
                    className="course-add-btn"
                    onClick={startAddingRecitation}
                    title="Add recitation"
                  >
                    +
                  </button>
                )}
              </div>
              {recExpanded && (
                <ul className="lecture-list recitation-list">
                  <LectureListProvider kind="recitation">
                    <LectureList />
                    <AddLectureInput />
                  </LectureListProvider>
                </ul>
              )}
            </li>
          </ul>
        )}
      </div>
    </CourseGroupContext.Provider>
  )
}
