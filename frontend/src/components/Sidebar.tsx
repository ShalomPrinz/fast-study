import { useState, useEffect, useRef } from 'react'
import { toast } from 'react-toastify'
import type { Course, Lecture, Selected, Kind } from '../types'
import { createCourse, createLecture, renameCourse, renameLecture, uploadVideo } from '../services/database'
import ConfirmModal from './ConfirmModal'
import Icon from './Icon'
import NewCourseRow from './NewCourseRow'
import ResumePipelineRow from './ResumePipelineRow'
import { useInlineEdit } from '../hooks/useInlineEdit'
import { recitationGroupKey, suggestName } from '../utils/lectureNaming'

interface Props {
  courses: Course[]
  selected: Selected | null
  onSelect: (course: string, lecture: string, kind: Kind) => void
  onCourseClick: (course: string) => void
  onRefresh: () => Promise<void> | void
}

interface PendingUpload {
  course: string
  lecture: string
  file: File
  kind: Kind
}

interface AddTarget { course: string; kind: Kind }
interface RenameTarget { course: string; lecture: string; kind: Kind }
interface DragTarget { course: string; lecture: string; kind: Kind }

export default function Sidebar({ courses, selected, onSelect, onCourseClick, onRefresh }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [recitationsExpanded, setRecitationsExpanded] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState<AddTarget | null>(null)
  const [renaming, setRenaming] = useState<RenameTarget | null>(null)
  const [dragOver, setDragOver] = useState<DragTarget | null>(null)
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null)
  const [addingCourse, setAddingCourse] = useState(false)
  const [renamingCourse, setRenamingCourse] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const didAutoExpandRef = useRef(false)

  useEffect(() => {
    if (didAutoExpandRef.current) return
    if (!selected) return
    if (!courses.find((c) => c.name === selected.course)) return
    didAutoExpandRef.current = true
    setExpanded((prev) => new Set([...prev, selected.course]))
    if (selected.kind === 'recitation') {
      setRecitationsExpanded((prev) => new Set([...prev, recitationGroupKey(selected.course)]))
    }
  }, [selected, courses])

  async function handleRefreshClick() {
    if (refreshing) return
    setRefreshing(true)
    try { await onRefresh() } finally { setRefreshing(false) }
  }

  const addLectureEdit = useInlineEdit(adding ? `${adding.course}::${adding.kind}` : null)
  const renameLectureEdit = useInlineEdit(renaming ? `${renaming.course}/${renaming.kind}/${renaming.lecture}` : null)
  const addCourseEdit = useInlineEdit(addingCourse || null)
  const renameCourseEdit = useInlineEdit(renamingCourse)

  useEffect(() => {
    setExpanded((prev) => {
      const names = new Set(courses.map((c) => c.name))
      return new Set([...prev].filter((n) => names.has(n)))
    })
    setRecitationsExpanded((prev) => {
      const keys = new Set(courses.map((c) => recitationGroupKey(c.name)))
      return new Set([...prev].filter((k) => keys.has(k)))
    })
  }, [courses])

  function toggleCourse(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
    onCourseClick(name)
  }

  function toggleRecitations(courseName: string) {
    const key = recitationGroupKey(courseName)
    setRecitationsExpanded((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function startAdding(e: React.MouseEvent, courseName: string, kind: Kind) {
    e.stopPropagation()
    setAdding({ course: courseName, kind })
    addLectureEdit.setValue(suggestName(courses, courseName, kind))
    setExpanded((prev) => new Set([...prev, courseName]))
    if (kind === 'recitation') {
      setRecitationsExpanded((prev) => new Set([...prev, recitationGroupKey(courseName)]))
    }
  }

  async function commitAdd() {
    const name = addLectureEdit.value.trim()
    const target = adding!
    setAdding(null)
    addLectureEdit.setValue('')
    if (!name) return
    await createLecture(target.course, name, target.kind)
    onCourseClick(target.course)
  }

  async function doUpload(courseName: string, lectureName: string, file: File, kind: Kind) {
    await toast.promise(uploadVideo(courseName, lectureName, file, kind), {
      pending: 'Uploading video…',
      success: `Saved to ${lectureName}`,
      error: 'Upload failed',
    })
    onCourseClick(courseName)
  }

  function handleDrop(e: React.DragEvent, courseName: string, lectureName: string, kind: Kind) {
    e.preventDefault()
    setDragOver(null)
    const file = e.dataTransfer.files[0]
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.mp4') && file.type !== 'video/mp4') {
      toast.error('Only .mp4 files are allowed')
      return
    }
    const course = courses.find((c) => c.name === courseName)
    const list = kind === 'recitation' ? course?.recitations : course?.lectures
    const lecture = list?.find((l) => l.name === lectureName)
    if (lecture?.files['video.mp4'].exists) {
      setPendingUpload({ course: courseName, lecture: lectureName, file, kind })
    } else {
      doUpload(courseName, lectureName, file, kind)
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
    onCourseClick(info.course)
  }

  async function commitAddCourse() {
    const name = addCourseEdit.value.trim()
    setAddingCourse(false)
    addCourseEdit.setValue('')
    if (!name) return
    await createCourse(name)
    onRefresh()
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
    onRefresh()
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
          <input
            ref={renameLectureEdit.ref}
            className="lecture-add-input"
            value={renameLectureEdit.value}
            onChange={(e) => renameLectureEdit.setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') { setRenaming(null); renameLectureEdit.setValue('') }
            }}
            onBlur={() => { setRenaming(null); renameLectureEdit.setValue('') }}
            dir="auto"
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
        <button
          className={`sidebar-refresh-btn${refreshing ? ' spinning' : ''}`}
          onClick={handleRefreshClick}
          disabled={refreshing}
          title="Refresh Courses Tree"
          aria-label="Refresh Courses Tree"
        >
          <Icon icon="refresh" />
        </button>
      </div>
      <NewCourseRow
        addingCourse={addingCourse}
        addCourseEdit={addCourseEdit}
        onStart={() => setAddingCourse(true)}
        onCommit={commitAddCourse}
        onCancel={() => { setAddingCourse(false); addCourseEdit.setValue('') }}
      />
      <ResumePipelineRow />
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
                  <input
                    ref={renameCourseEdit.ref}
                    className="lecture-add-input"
                    value={renameCourseEdit.value}
                    onChange={(e) => renameCourseEdit.setValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRenameCourse()
                      if (e.key === 'Escape') { setRenamingCourse(null); renameCourseEdit.setValue('') }
                    }}
                    onBlur={() => { setRenamingCourse(null); renameCourseEdit.setValue('') }}
                    dir="auto"
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
                  {course.lectures.map((lecture) => renderLectureItem(course.name, lecture, 'lecture'))}

                  {isAddingLecture && (
                    <li>
                      <input
                        ref={addLectureEdit.ref}
                        className="lecture-add-input"
                        value={addLectureEdit.value}
                        onChange={(e) => addLectureEdit.setValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitAdd()
                          if (e.key === 'Escape') { setAdding(null); addLectureEdit.setValue('') }
                        }}
                        onBlur={() => { setAdding(null); addLectureEdit.setValue('') }}
                        placeholder="Lecture name…"
                        dir="auto"
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
                        {(course.recitations ?? []).map((rec) => renderLectureItem(course.name, rec, 'recitation'))}
                        {isAddingRecitation && (
                          <li>
                            <input
                              ref={addLectureEdit.ref}
                              className="lecture-add-input"
                              value={addLectureEdit.value}
                              onChange={(e) => addLectureEdit.setValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') commitAdd()
                                if (e.key === 'Escape') { setAdding(null); addLectureEdit.setValue('') }
                              }}
                              onBlur={() => { setAdding(null); addLectureEdit.setValue('') }}
                              placeholder="Recitation name…"
                              dir="auto"
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

      {pendingUpload && (
        <ConfirmModal
          message={`Replace existing video.mp4 in "${pendingUpload.lecture}"?`}
          warning={`Note: This will delete all files in this lecture.`}
          onConfirm={() => {
            const { course, lecture, file, kind } = pendingUpload
            setPendingUpload(null)
            doUpload(course, lecture, file, kind)
          }}
          onCancel={() => setPendingUpload(null)}
        />
      )}
    </aside>
  )
}
