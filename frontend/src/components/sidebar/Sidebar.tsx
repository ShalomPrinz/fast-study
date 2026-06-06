import { useState, useEffect, useRef } from 'react'
import type { Lecture, Selected, Kind } from '@/types'
import { createLecture, renameCourse, renameLecture } from '@/services/database'
import { toast } from '@/services/toaster'
import InlineEditInput from '@/components/InlineEditInput'
import RefreshCoursesButton from './RefreshCoursesButton'
import NewCourseRow from './NewCourseRow'
import { usePendingUpload } from './PendingUploadModal'
import RunnerPipelineRow from './RunnerPipelineRow'
import PaginatedList from './PaginatedList'
import { useInlineEdit } from '@/hooks/useInlineEdit'
import { useToggleSet } from '@/hooks/useToggleSet'
import { useCourseTreeContext } from '@/contexts/CourseTreeContext'
import { suggestName } from '@/utils/namingSuggestion'
import { findLecture } from '@/utils/courseTree'

interface Props {
  selected: Selected | null
  onSelect: (course: string, lecture: string, kind: Kind) => void
}

interface AddTarget { course: string; kind: Kind }
interface RenameTarget { course: string; lecture: string; kind: Kind }
interface DragTarget { course: string; lecture: string; kind: Kind }

function recitationGroupKey(courseName: string): string {
  return `${courseName}::recitations`
}

export default function Sidebar({ selected, onSelect }: Props) {
  const { courses, refreshCourses } = useCourseTreeContext()
  const expanded = useToggleSet(courses.map((c) => c.name))
  const recitationsExpanded = useToggleSet(courses.map((c) => recitationGroupKey(c.name)))
  const [adding, setAdding] = useState<AddTarget | null>(null)
  const [renaming, setRenaming] = useState<RenameTarget | null>(null)
  const [dragOver, setDragOver] = useState<DragTarget | null>(null)
  const [renamingCourse, setRenamingCourse] = useState<string | null>(null)
  const didAutoExpandRef = useRef(false)
  const upload = usePendingUpload()

  useEffect(() => {
    if (didAutoExpandRef.current) return
    if (!selected) return
    if (!courses.find((c) => c.name === selected.course)) return
    didAutoExpandRef.current = true
    expanded.add(selected.course)
    if (selected.kind === 'recitation') {
      recitationsExpanded.add(recitationGroupKey(selected.course))
    }
  }, [selected, courses])

  const addLectureEdit = useInlineEdit(adding ? `${adding.course}::${adding.kind}` : null)
  const renameLectureEdit = useInlineEdit(renaming ? `${renaming.course}/${renaming.kind}/${renaming.lecture}` : null)
  const renameCourseEdit = useInlineEdit(renamingCourse)

  function toggleCourse(name: string) {
    expanded.toggle(name)
    refreshCourses()
  }

  function toggleRecitations(courseName: string) {
    recitationsExpanded.toggle(recitationGroupKey(courseName))
  }

  function startAdding(e: React.MouseEvent, courseName: string, kind: Kind) {
    e.stopPropagation()
    setAdding({ course: courseName, kind })
    addLectureEdit.setValue(suggestName(courses, courseName, kind))
    expanded.add(courseName)
    if (kind === 'recitation') {
      recitationsExpanded.add(recitationGroupKey(courseName))
    }
  }

  async function commitAdd() {
    const name = addLectureEdit.value.trim()
    const target = adding!
    setAdding(null)
    addLectureEdit.setValue('')
    if (!name) return
    await createLecture(target.course, name, target.kind)
    refreshCourses()
  }

  function handleDrop(e: React.DragEvent, courseName: string, lectureName: string, kind: Kind) {
    e.preventDefault()
    setDragOver(null)
    const file = e.dataTransfer.files[0]
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.mp4') && file.type !== 'video/mp4') {
      toast('error', 'Only .mp4 files are allowed')
      return
    }
    const lecture = findLecture(courses, courseName, lectureName, kind)
    if (lecture?.files['video.mp4'].exists) {
      upload.confirm(courseName, lectureName, file, kind)
    } else {
      upload.trigger(courseName, lectureName, file, kind)
    }
  }

  function startRenaming(e: React.MouseEvent, courseName: string, lectureName: string, kind: Kind) {
    e.preventDefault()
    setRenaming({ course: courseName, lecture: lectureName, kind })
    renameLectureEdit.setValue(lectureName)
  }

  async function commitRename() {
    const name = renameLectureEdit.value.trim()
    const info = renaming!
    setRenaming(null)
    renameLectureEdit.setValue('')
    if (!name || name === info.lecture) return
    await renameLecture(info.course, info.lecture, name, info.kind)
    if (selected?.course === info.course && selected?.lecture === info.lecture && selected?.kind === info.kind) {
      onSelect(info.course, name, info.kind)
    }
    refreshCourses()
  }

  function startRenamingCourse(e: React.MouseEvent, courseName: string) {
    e.preventDefault()
    setRenamingCourse(courseName)
    renameCourseEdit.setValue(courseName)
  }

  async function commitRenameCourse() {
    const name = renameCourseEdit.value.trim()
    const old = renamingCourse!
    setRenamingCourse(null)
    renameCourseEdit.setValue('')
    if (!name || name === old) return
    await renameCourse(old, name)
    if (selected?.course === old) {
      onSelect(name, selected.lecture, selected.kind)
    }
    refreshCourses()
  }

  function renderLectureItem(courseName: string, lecture: Lecture, kind: Kind) {
    const isSelected =
      selected?.course === courseName && selected?.lecture === lecture.name && selected?.kind === kind
    const isRenaming =
      renaming?.course === courseName && renaming?.lecture === lecture.name && renaming?.kind === kind
    const isDragOver =
      dragOver?.course === courseName && dragOver?.lecture === lecture.name && dragOver?.kind === kind

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
              if (e.shiftKey) startRenaming(e, courseName, lecture.name, kind)
              else onSelect(courseName, lecture.name, kind)
            }}
            onDragOver={(e) => { e.preventDefault(); setDragOver({ course: courseName, lecture: lecture.name, kind }) }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => handleDrop(e, courseName, lecture.name, kind)}
            dir="auto"
          >
            {lecture.name}
          </button>
        )}
      </li>
    )
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span>Fast Study</span>
        <RefreshCoursesButton />
      </div>
      <NewCourseRow />
      <RunnerPipelineRow />
      <nav className="sidebar-nav">
        {courses.map((course) => {
          const recKey = recitationGroupKey(course.name)
          const recExpanded = recitationsExpanded.has(recKey)
          const isAddingLecture = adding?.course === course.name && adding.kind === 'lecture'
          const isAddingRecitation = adding?.course === course.name && adding.kind === 'recitation'
          return (
            <div key={course.name} className="course-group">
              <div className="course-header">
                {renamingCourse === course.name ? (
                  <InlineEditInput
                    edit={renameCourseEdit}
                    onCommit={commitRenameCourse}
                    onCancel={() => { setRenamingCourse(null); renameCourseEdit.setValue('') }}
                  />
                ) : (
                <button
                  className="course-toggle"
                  onClick={(e) => {
                    if (e.shiftKey) startRenamingCourse(e, course.name)
                    else toggleCourse(course.name)
                  }}
                  dir="auto"
                >
                  <span className="chevron">{expanded.has(course.name) ? '▾' : '▸'}</span>
                  <span>{course.name}</span>
                </button>
                )}
                {renamingCourse !== course.name && (
                  <button
                    className="course-add-btn"
                    onClick={(e) => startAdding(e, course.name, 'lecture')}
                    title="Add lecture"
                  >
                    +
                  </button>
                )}
              </div>

              {expanded.has(course.name) && (
                <ul className="lecture-list">
                  <PaginatedList
                    items={course.lectures}
                    renderItem={(lecture) => renderLectureItem(course.name, lecture, 'lecture')}
                  />

                  {isAddingLecture && (
                    <li>
                      <InlineEditInput
                        edit={addLectureEdit}
                        onCommit={commitAdd}
                        onCancel={() => { setAdding(null); addLectureEdit.setValue('') }}
                        placeholder="Lecture name…"
                      />
                    </li>
                  )}

                  <li className="recitations-group">
                    <div className="recitations-header">
                      <button
                        className="course-toggle recitations-toggle"
                        onClick={() => toggleRecitations(course.name)}
                        dir="auto"
                      >
                        <span className="chevron">{recExpanded ? '▾' : '▸'}</span>
                        <span>Recitations</span>
                      </button>
                      <button
                        className="course-add-btn"
                        onClick={(e) => startAdding(e, course.name, 'recitation')}
                        title="Add recitation"
                      >
                        +
                      </button>
                    </div>
                    {recExpanded && (
                      <ul className="lecture-list recitation-list">
                        <PaginatedList
                          items={course.recitations ?? []}
                          renderItem={(rec) => renderLectureItem(course.name, rec, 'recitation')}
                        />
                        {isAddingRecitation && (
                          <li>
                            <InlineEditInput
                              edit={addLectureEdit}
                              onCommit={commitAdd}
                              onCancel={() => { setAdding(null); addLectureEdit.setValue('') }}
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
          )
        })}
      </nav>

      {upload.modal}
    </aside>
  )
}
