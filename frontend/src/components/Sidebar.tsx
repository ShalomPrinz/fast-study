import { useState, useEffect, useRef } from 'react'
import { toast } from 'react-toastify'
import { Course, createLecture, renameLecture, uploadVideo } from '../api'
import { Selected } from '../App'
import ConfirmModal from './ConfirmModal'

interface Props {
  courses: Course[]
  selected: Selected | null
  onSelect: (course: string, lecture: string) => void
  onCourseClick: (course: string) => void
}

interface PendingUpload {
  course: string
  lecture: string
  file: File
}

export default function Sidebar({ courses, selected, onSelect, onCourseClick }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState<{ course: string; lecture: string } | null>(null)
  const [renameName, setRenameName] = useState('')
  const [dragOver, setDragOver] = useState<{ course: string; lecture: string } | null>(null)
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null)
  const addInputRef = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setExpanded((prev) => {
      const names = new Set(courses.map((c) => c.name))
      return new Set([...prev].filter((n) => names.has(n)))
    })
  }, [courses])

  useEffect(() => {
    if (adding) { addInputRef.current?.focus(); addInputRef.current?.select() }
  }, [adding])

  useEffect(() => {
    if (renaming) { renameInputRef.current?.focus(); renameInputRef.current?.select() }
  }, [renaming])

  function suggestName(courseName: string): string {
    const course = courses.find((c) => c.name === courseName)
    if (!course) return ''
    const nums = course.lectures
      .map((l) => { const m = l.name.match(/^Lecture\s+(\d+)$/i); return m ? parseInt(m[1], 10) : null })
      .filter((n): n is number => n !== null)
    return `Lecture ${nums.length ? Math.max(...nums) + 1 : 1}`
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
    setNewName(suggestName(courseName))
    setExpanded((prev) => new Set([...prev, courseName]))
  }

  async function commitAdd() {
    const name = newName.trim()
    const course = adding!
    setAdding(null)
    setNewName('')
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
    if (lecture?.files['video.mp4']) {
      setPendingUpload({ course: courseName, lecture: lectureName, file })
    } else {
      doUpload(courseName, lectureName, file)
    }
  }

  function startRenaming(e: React.MouseEvent, courseName: string, lectureName: string) {
    e.preventDefault()
    setRenaming({ course: courseName, lecture: lectureName })
    setRenameName(lectureName)
  }

  async function commitRename() {
    const name = renameName.trim()
    const info = renaming!
    setRenaming(null)
    setRenameName('')
    if (!name || name === info.lecture) return
    await renameLecture(info.course, info.lecture, name)
    onCourseClick(info.course)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">Fast Study</div>
      <nav className="sidebar-nav">
        {courses.map((course) => (
          <div key={course.name} className="course-group">
            <div className="course-header">
              <button
                className="course-toggle"
                onClick={() => toggleCourse(course.name)}
                dir="auto"
              >
                <span className="chevron">{expanded.has(course.name) ? '▾' : '▸'}</span>
                <span>{course.name}</span>
              </button>
              <button
                className="course-add-btn"
                onClick={(e) => startAdding(e, course.name)}
                title="Add lecture"
              >
                +
              </button>
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
                          ref={renameInputRef}
                          className="lecture-add-input"
                          value={renameName}
                          onChange={(e) => setRenameName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename()
                            if (e.key === 'Escape') { setRenaming(null); setRenameName('') }
                          }}
                          onBlur={() => { setRenaming(null); setRenameName('') }}
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
                      ref={addInputRef}
                      className="lecture-add-input"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitAdd()
                        if (e.key === 'Escape') { setAdding(null); setNewName('') }
                      }}
                      onBlur={() => { setAdding(null); setNewName('') }}
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
