import { useState, useEffect, useRef } from 'react'
import { useMatch } from 'react-router-dom'
import type { Course } from '@/types'
import { useSelection } from '@/features/lectures/hooks/useSelection'
import { useAddLecture } from '@/features/lectures/hooks/useAddLecture'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { CourseGroupContext } from './CourseGroupContext'
import { LectureListProvider } from './LectureListContext'
import CourseHeader from './CourseHeader'
import CourseOverviewRow from './CourseOverviewRow'
import LectureList from './LectureList'
import AddLectureInput from './AddLectureInput'
import RecitationsGroup from './RecitationsGroup'
import '@/styles/sidebar-tree.css'
import './CourseGroup.css'

// Module scope outlives the tree pane's unmount, so active courses reopen as the user left them.
const savedExpansion = new Map<string, { expanded: boolean; recExpanded: boolean }>()

export default function CourseGroup({ course }: { course: Course }) {
  const { selected } = useSelection()
  const overviewCourse = useMatch('/course/:course/overview')?.params.course
  const { refreshCourses } = useCourseTreeContext()
  const add = useAddLecture(course)

  const saved = course.archived ? undefined : savedExpansion.get(course.name)
  const [expanded, setExpanded] = useState(saved?.expanded ?? false)
  const [recExpanded, setRecExpanded] = useState(saved?.recExpanded ?? false)
  const didAutoExpandRef = useRef(false)

  useEffect(() => {
    if (!course.archived) savedExpansion.set(course.name, { expanded, recExpanded })
  }, [course.name, course.archived, expanded, recExpanded])

  // Expand once when this course's lecture or overview first becomes the open page (deep link).
  // Runs again on remount, deliberately overriding a remembered collapse so the open page's course shows.
  useEffect(() => {
    if (didAutoExpandRef.current) return
    const onLecture = selected?.course === course.name
    if (!onLecture && overviewCourse !== course.name) return
    didAutoExpandRef.current = true
    setExpanded(true)
    if (onLecture && selected.kind === 'recitation') setRecExpanded(true)
  }, [selected, overviewCourse, course.name])

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
            <CourseOverviewRow />
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
