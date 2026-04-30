import { useState, useEffect } from 'react'
import { Course } from '../api'
import { Selected } from '../App'

interface Props {
  courses: Course[]
  selected: Selected | null
  onSelect: (course: string, lecture: string) => void
}

export default function Sidebar({ courses, selected, onSelect }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    setExpanded(new Set(courses.map((c) => c.name)))
  }, [courses])

  function toggleCourse(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">Fast Study</div>
      <nav className="sidebar-nav">
        {courses.map((course) => (
          <div key={course.name} className="course-group">
            <button
              className="course-toggle"
              onClick={() => toggleCourse(course.name)}
              dir="auto"
            >
              <span className="chevron">{expanded.has(course.name) ? '▾' : '▸'}</span>
              <span>{course.name}</span>
            </button>

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
              </ul>
            )}
          </div>
        ))}
      </nav>
    </aside>
  )
}
