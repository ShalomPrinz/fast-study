import { useState, useEffect, useRef } from 'react'
import { useMatch } from 'react-router-dom'
import { ROUTES, routeParam } from '@/shared/utils/routes'
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
import AssignmentsGroup from './AssignmentsGroup'
import { saveExpansion, savedExpansion } from '@/features/lectures/utils/courseExpansion'
import '@/styles/sidebar-tree.css'
import './CourseGroup.css'

export default function CourseGroup({
  course,
  onRenamed,
}: {
  course: Course
  onRenamed: (from: string, to: string) => void
}) {
  const { selected } = useSelection()
  const overviewMatch = useMatch(ROUTES.overview)
  const overviewCourse = overviewMatch ? routeParam(overviewMatch.params.course) : undefined
  const { refreshCourses } = useCourseTreeContext()
  const add = useAddLecture(course)

  const saved = savedExpansion(course.name)
  // The tree remounts this group on every swap, so a collapse lasts only while the course stays open.
  const [expanded, setExpanded] = useState(true)
  const [recExpanded, setRecExpanded] = useState(saved?.recExpanded ?? false)
  const [assignExpanded, setAssignExpanded] = useState(saved?.assignExpanded ?? false)
  const assignmentMatch = useMatch(ROUTES.assignment)
  const assignmentCourse = assignmentMatch ? routeParam(assignmentMatch.params.course) : undefined
  const didAutoExpandRef = useRef(false)

  useEffect(() => {
    saveExpansion(course.name, { recExpanded, assignExpanded })
  }, [course.name, recExpanded, assignExpanded])

  // Open the groups holding the open page once (deep link); runs again on remount, overriding a remembered collapse.
  useEffect(() => {
    if (didAutoExpandRef.current) return
    const onLecture = selected?.course === course.name
    if (!onLecture && overviewCourse !== course.name && assignmentCourse !== course.name) return
    didAutoExpandRef.current = true
    if (assignmentCourse === course.name) setAssignExpanded(true)
    if (onLecture && selected.kind === 'recitation') setRecExpanded(true)
  }, [selected, overviewCourse, assignmentCourse, course.name])

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
            {!course.lectures_only && (
              <RecitationsGroup
                expand={{
                  isOpen: recExpanded,
                  toggle: () => setRecExpanded((v) => !v),
                  open: () => setRecExpanded(true),
                }}
              />
            )}

            <AssignmentsGroup
              expand={{
                isOpen: assignExpanded,
                toggle: () => setAssignExpanded((v) => !v),
                open: () => setAssignExpanded(true),
              }}
            />
          </ul>
        )}
      </div>
    </CourseGroupContext.Provider>
  )
}
