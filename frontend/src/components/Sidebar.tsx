import { useState, useEffect, useRef } from 'react'
import { Course, createLecture } from '../api'
import { Selected } from '../App'

interface Props {
  courses: Course[]
  selected: Selected | null
  onSelect: (course: string, lecture: string) => void
  onCourseClick: (course: string) => void
}

export default function Sidebar({ courses, selected, onSelect, onCourseClick }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setExpanded((prev) => {
      const names = new Set(courses.map((c) => c.name))
      const next = new Set([...prev].filter((n) => names.has(n)))
      courses.forEach((c) => { if (!prev.has(c.name)) next.add(c.name) })
      return next
    })
  }, [courses])

  useEffect(() => {
    if (adding) inputRef.current?.focus()
  }, [adding])

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
    setNewName('')
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

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') commitAdd()
    if (e.key === 'Escape') { setAdding(null); setNewName('') }
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
                  return (
                    <li key={lecture.name}>
                      <button
                        className={`lecture-btn${isSelected ? ' selected' : ''}`}
                        onClick={() => onSelect(course.name, lecture.name)}
                        dir="auto"
                      >
                        {lecture.name}
                      </button>
                    </li>
                  )
                })}

                {adding === course.name && (
                  <li>
                    <input
                      ref={inputRef}
                      className="lecture-add-input"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={handleKeyDown}
                      onBlur={commitAdd}
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
    </aside>
  )
}
