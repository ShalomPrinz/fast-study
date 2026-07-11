import { useState, useEffect, useRef } from 'react'
import type { Course, Kind } from '@/types'
import { renameCourse, setCourseArchived } from '@/services/database'
import { useSelection } from '@/hooks/useSelection'
import { useShiftHeld } from '@/hooks/useShiftHeld'
import { useInlineEdit } from '@/hooks/useInlineEdit'
import { useAddLecture } from '@/hooks/useAddLecture'
import { useCourseTreeContext } from '@/contexts/CourseTreeContext'
import Icon from '@/components/Icon'
import InlineEditInput from '@/components/InlineEditInput'
import PaginatedList from '@/components/sidebar/PaginatedList'
import { CourseGroupContext } from './CourseGroupContext'
import LectureItem from './LectureItem'

export default function CourseGroup({ course }: { course: Course }) {
  const { selected, onSelect } = useSelection()
  const { refreshCourses } = useCourseTreeContext()
  const shiftHeld = useShiftHeld()
  const add = useAddLecture(course)

  const [expanded, setExpanded] = useState(false)
  const [recExpanded, setRecExpanded] = useState(false)
  const [renamingCourse, setRenamingCourse] = useState(false)
  const didAutoExpandRef = useRef(false)

  const renameCourseEdit = useInlineEdit(renamingCourse ? course.name : null)

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

  function startAdding(e: React.MouseEvent, kind: Kind) {
    e.stopPropagation()
    setExpanded(true)
    if (kind === 'recitation') setRecExpanded(true)
    add.start(kind)
  }

  function startRenamingCourse(e: React.MouseEvent) {
    e.preventDefault()
    setRenamingCourse(true)
    renameCourseEdit.setValue(course.name)
  }

  async function commitRenameCourse() {
    const name = renameCourseEdit.value.trim()
    setRenamingCourse(false)
    renameCourseEdit.setValue('')
    if (!name || name === course.name) return
    await renameCourse(course.name, name)
    if (selected?.course === course.name) {
      onSelect(name, selected.lecture, selected.kind)
    }
    refreshCourses()
  }

  async function toggleArchived(e: React.MouseEvent) {
    e.stopPropagation()
    await setCourseArchived(course.name, !course.archived)
    refreshCourses()
  }

  const isAddingLecture = add.target?.kind === 'lecture'
  const isAddingRecitation = add.target?.kind === 'recitation'

  return (
    <CourseGroupContext.Provider value={{ course, add }}>
      <div className="course-group">
        <div className="course-header">
          {renamingCourse ? (
            <InlineEditInput
              edit={renameCourseEdit}
              onCommit={commitRenameCourse}
              onCancel={() => { setRenamingCourse(false); renameCourseEdit.setValue('') }}
            />
          ) : (
          <button
            className="course-toggle"
            onClick={(e) => {
              if (e.shiftKey) startRenamingCourse(e)
              else toggleCourse()
            }}
            dir="auto"
          >
            <span className="chevron">{expanded ? '▾' : '▸'}</span>
            <span>{course.name}</span>
          </button>
          )}
          {!renamingCourse && (
            shiftHeld ? (
              <button
                className="course-add-btn course-archive-btn"
                onClick={toggleArchived}
                title={course.archived ? 'Unarchive course' : 'Archive course'}
              >
                <Icon icon={course.archived ? 'unarchive' : 'archive'} />
              </button>
            ) : (
              <button
                className="course-add-btn"
                onClick={(e) => startAdding(e, 'lecture')}
                title="Add lecture"
              >
                +
              </button>
            )
          )}
        </div>

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
                    onClick={(e) => startAdding(e, 'recitation')}
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
