import { useState, useEffect, useRef } from 'react'
import type { Course } from '@/types'
import { useSelection } from '@/hooks/useSelection'
import { useShiftHeld } from '@/hooks/useShiftHeld'
import { useAddLecture } from '@/hooks/useAddLecture'
import { useCourseTreeContext } from '@/contexts/CourseTreeContext'
import InlineEditInput from '@/components/InlineEditInput'
import PaginatedList from '@/components/sidebar/PaginatedList'
import { CourseGroupContext } from './CourseGroupContext'
import CourseHeader from './CourseHeader'
import LectureItem from './LectureItem'

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

  const isAddingLecture = add.target?.kind === 'lecture'
  const isAddingRecitation = add.target?.kind === 'recitation'

  return (
    <CourseGroupContext.Provider value={{ course, add }}>
      <div className="course-group">
        <CourseHeader
          expand={{ isOpen: expanded, toggle: toggleCourse, open: () => setExpanded(true) }}
        />

        {expanded && (
          <ul className="lecture-list">
            <PaginatedList
              items={course.lectures}
              renderItem={(lecture) => (
                <LectureItem key={`lecture::${lecture.name}`} lecture={lecture} kind="lecture" />
              )}
            />

            {isAddingLecture && (
              <li>
                <InlineEditInput
                  edit={add.edit}
                  onCommit={add.commit}
                  onCancel={add.cancel}
                  placeholder="Lecture name…"
                />
              </li>
            )}

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
                  <PaginatedList
                    items={course.recitations ?? []}
                    renderItem={(rec) => (
                      <LectureItem key={`recitation::${rec.name}`} lecture={rec} kind="recitation" />
                    )}
                  />
                  {isAddingRecitation && (
                    <li>
                      <InlineEditInput
                        edit={add.edit}
                        onCommit={add.commit}
                        onCancel={add.cancel}
                        placeholder="Recitation name…"
                      />
                    </li>
                  )}
                </ul>
              )}
            </li>
          </ul>
        )}
      </div>
    </CourseGroupContext.Provider>
  )
}
