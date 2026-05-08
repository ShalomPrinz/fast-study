import { useState, useEffect } from 'react'
import { toast } from 'react-toastify'
import type { Course, Selected } from '../types'
import { createCourse, createLecture, renameCourse, renameLecture, uploadVideo } from '../api'
import ConfirmModal from './ConfirmModal'
import { useInlineEdit } from '../hooks/useInlineEdit'

interface Props {
  courses: Course[]
  selected: Selected | null
  onSelect: (course: string, lecture: string) => void
  onCourseClick: (course: string) => void
  onRefresh: () => void
}

interface PendingUpload {
  course: string
  lecture: string
  file: File
}

export default function Sidebar({ courses, selected, onSelect, onCourseClick, onRefresh }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ course: string; lecture: string } | null>(null)
  const [dragOver, setDragOver] = useState<{ course: string; lecture: string } | null>(null)
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null)
  const [addingCourse, setAddingCourse] = useState(false)
  const [renamingCourse, setRenamingCourse] = useState<string | null>(null)

  const addLectureEdit = useInlineEdit(adding)
  const renameLectureEdit = useInlineEdit(renaming)
  const addCourseEdit = useInlineEdit(addingCourse || null)
  const renameCourseEdit = useInlineEdit(renamingCourse)

  useEffect(() => {
    setExpanded((prev) => {
      const names = new Set(courses.map((c) => c.name))
      return new Set([...prev].filter((n) => names.has(n)))
    })
  }, [courses])

  function suggestName(courseName: string): string {
    const course = courses.find((c) => c.name === courseName)
    if (!course) return ''
    const matches = course.lectures
      .map((l) => { const m = l.name.match(/^Lecture\s+(\d+)(?:\.(\d+))?$/i); return m ? { n: parseInt(m[1], 10), sub: m[2] ? parseInt(m[2], 10) : 0 } : null })
      .filter((x): x is { n: number; sub: number } => x !== null)
    if (!matches.length) return 'Lecture 1'
    const latest = matches.reduce((a, b) => a.n > b.n || (a.n === b.n && a.sub > b.sub) ? a : b)
    if (latest.sub === 0) return `Lecture ${latest.n + 1}`
    if (latest.sub === 1) return `Lecture ${latest.n}.2`
    return `Lecture ${latest.n + 1}`
  }

  function toggleCourse(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
    onCourseClick(name)
  }

  function startAdding(e: React.MouseEvent, courseName: string) {
    e.stopPropagation()
    setAdding(courseName)
    addLectureEdit.setValue(suggestName(courseName))
    setExpanded((prev) => new Set([...prev, courseName]))
  }

  async function commitAdd() {
    const name = addLectureEdit.value.trim()
    const course = adding!
    setAdding(null)
    addLectureEdit.setValue('')
    if (!name) return
    await createLecture(course, name)
    onCourseClick(course)
  }

  async function doUpload(courseName: string, lectureName: string, file: File) {
    await toast.promise(uploadVideo(courseName, lectureName, file), {
      pending: 'Uploading video…',
      success: `Saved to ${lectureName}`,
      error: 'Upload failed',
    })
    onCourseClick(courseName)
  }

  function handleDrop(e: React.DragEvent, courseName: string, lectureName: string) {
    e.preventDefault()
    setDragOver(null)
    const file = e.dataTransfer.files[0]
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.mp4') && file.type !== 'video/mp4') {
      toast.error('Only .mp4 files are allowed')
      return
    }
    const course = courses.find((c) => c.name === courseName)
    const lecture = course?.lectures.find((l) => l.name === lectureName)
    if (lecture?.files['video.mp4'].exists) {
      setPendingUpload({ course: courseName, lecture: lectureName, file })
    } else {
      doUpload(courseName, lectureName, file)
    }
  }

  function startRenaming(e: React.MouseEvent, courseName: string, lectureName: string) {
    e.preventDefault()
    setRenaming({ course: courseName, lecture: lectureName })
    renameLectureEdit.setValue(lectureName)
  }

  async function commitRename() {
    const name = renameLectureEdit.value.trim()
    const info = renaming!
    setRenaming(null)
    renameLectureEdit.setValue('')
    if (!name || name === info.lecture) return
    await renameLecture(info.course, info.lecture, name)
    if (selected?.course === info.course && selected?.lecture === info.lecture) {
      onSelect(info.course, name)
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
      onSelect(name, selected.lecture)
    }
    onRefresh()
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">Fast Study</div>
      <div className="new-course-row">
        {addingCourse ? (
          <input
            ref={addCourseEdit.ref}
            className="new-course-input"
            value={addCourseEdit.value}
            onChange={(e) => addCourseEdit.setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitAddCourse()
              if (e.key === 'Escape') { setAddingCourse(false); addCourseEdit.setValue('') }
            }}
            onBlur={() => { setAddingCourse(false); addCourseEdit.setValue('') }}
            placeholder="Course name…"
            dir="auto"
          />
        ) : (
          <button className="new-course-btn" onClick={() => setAddingCourse(true)}>
            + New Course
          </button>
        )}
      </div>
      <nav className="sidebar-nav">
        {courses.map((course) => (
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
                  onClick={(e) => startAdding(e, course.name)}
                  title="Add lecture"
                >
                  +
                </button>
              )}
            </div>

            {expanded.has(course.name) && (
              <ul className="lecture-list">
                {course.lectures.map((lecture) => {
                  const isSelected =
                    selected?.course === course.name && selected?.lecture === lecture.name
                  const isRenaming =
                    renaming?.course === course.name && renaming?.lecture === lecture.name
                  const isDragOver =
                    dragOver?.course === course.name && dragOver?.lecture === lecture.name

                  return (
                    <li key={lecture.name}>
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
                            if (e.shiftKey) startRenaming(e, course.name, lecture.name)
                            else onSelect(course.name, lecture.name)
                          }}
                          onDragOver={(e) => { e.preventDefault(); setDragOver({ course: course.name, lecture: lecture.name }) }}
                          onDragLeave={() => setDragOver(null)}
                          onDrop={(e) => handleDrop(e, course.name, lecture.name)}
                          dir="auto"
                        >
                          {lecture.name}
                        </button>
                      )}
                    </li>
                  )
                })}

                {adding === course.name && (
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
              </ul>
            )}
          </div>
        ))}
      </nav>

      {pendingUpload && (
        <ConfirmModal
          message={`Replace existing video.mp4 in "${pendingUpload.lecture}"?`}
          warning={`Note: This will delete all files in this lecture.`}
          onConfirm={() => {
            const { course, lecture, file } = pendingUpload
            setPendingUpload(null)
            doUpload(course, lecture, file)
          }}
          onCancel={() => setPendingUpload(null)}
        />
      )}
    </aside>
  )
}
