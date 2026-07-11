import { useState, useEffect, useRef } from 'react'
import type { Course, Lecture, Kind } from '@/types'
import { renameCourse, renameLecture, setCourseArchived } from '@/services/database'
import { toast } from '@/services/toaster'
import { useSelection } from '@/hooks/useSelection'
import { useShiftHeld } from '@/hooks/useShiftHeld'
import { useInlineEdit } from '@/hooks/useInlineEdit'
import { useAddLecture } from '@/hooks/useAddLecture'
import { useCourseTreeContext } from '@/contexts/CourseTreeContext'
import { findLecture } from '@/utils/courseTree'
import Icon from '@/components/Icon'
import InlineEditInput from '@/components/InlineEditInput'
import PaginatedList from '@/components/sidebar/PaginatedList'
import { usePendingUpload } from '@/components/sidebar/PendingUploadModal'
import { CourseGroupContext } from './CourseGroupContext'

interface RenameTarget { lecture: string; kind: Kind }
interface DragTarget { lecture: string; kind: Kind }

export default function CourseGroup({ course }: { course: Course }) {
  const { selected, onSelect } = useSelection()
  const { courses, refreshCourses } = useCourseTreeContext()
  const upload = usePendingUpload()
  const shiftHeld = useShiftHeld()
  const add = useAddLecture(course)

  const [expanded, setExpanded] = useState(false)
  const [recExpanded, setRecExpanded] = useState(false)
  const [renaming, setRenaming] = useState<RenameTarget | null>(null)
  const [dragOver, setDragOver] = useState<DragTarget | null>(null)
  const [renamingCourse, setRenamingCourse] = useState(false)
  const didAutoExpandRef = useRef(false)

  const renameLectureEdit = useInlineEdit(renaming ? `${renaming.kind}/${renaming.lecture}` : null)
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

  function handleDrop(e: React.DragEvent, lectureName: string, kind: Kind) {
    e.preventDefault()
    setDragOver(null)
    const file = e.dataTransfer.files[0]
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.mp4') && file.type !== 'video/mp4') {
      toast('error', 'Only .mp4 files are allowed')
      return
    }
    const lecture = findLecture(courses, course.name, lectureName, kind)
    if (lecture?.files['video.mp4'].exists) {
      upload.confirm(course.name, lectureName, file, kind)
    } else {
      upload.trigger(course.name, lectureName, file, kind)
    }
  }

  function startRenaming(e: React.MouseEvent, lectureName: string, kind: Kind) {
    e.preventDefault()
    setRenaming({ lecture: lectureName, kind })
    renameLectureEdit.setValue(lectureName)
  }

  async function commitRename() {
    const name = renameLectureEdit.value.trim()
    const info = renaming!
    setRenaming(null)
    renameLectureEdit.setValue('')
    if (!name || name === info.lecture) return
    await renameLecture(course.name, info.lecture, name, info.kind)
    if (selected?.course === course.name && selected?.lecture === info.lecture && selected?.kind === info.kind) {
      onSelect(course.name, name, info.kind)
    }
    refreshCourses()
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

  function renderLectureItem(lecture: Lecture, kind: Kind) {
    const isSelected =
      selected?.course === course.name && selected?.lecture === lecture.name && selected?.kind === kind
    const isRenaming =
      renaming?.lecture === lecture.name && renaming?.kind === kind
    const isDragOver =
      dragOver?.lecture === lecture.name && dragOver?.kind === kind

    return (
      <li key={`${kind}::${lecture.name}`}>
        {isRenaming ? (
          <InlineEditInput
            edit={renameLectureEdit}
            onCommit={commitRename}
            onCancel={() => { setRenaming(null); renameLectureEdit.setValue('') }}
          />
        ) : (
          <button
            className={`lecture-btn${isSelected ? ' selected' : ''}${isDragOver ? ' drag-over' : ''}`}
            onClick={(e) => {
              if (e.shiftKey) startRenaming(e, lecture.name, kind)
              else onSelect(course.name, lecture.name, kind)
            }}
            onDragOver={(e) => { e.preventDefault(); setDragOver({ lecture: lecture.name, kind }) }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => handleDrop(e, lecture.name, kind)}
            dir="auto"
          >
            {lecture.name}
          </button>
        )}
      </li>
    )
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
              renderItem={(lecture) => renderLectureItem(lecture, 'lecture')}
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
                    renderItem={(rec) => renderLectureItem(rec, 'recitation')}
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
