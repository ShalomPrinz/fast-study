import { useState, useEffect } from 'react'
import { Course, Step } from '../api'
import { Selected } from '../App'

const ACTIONS: { step: Step; label: string }[] = [
  { step: 'audio', label: 'Extract Audio' },
  { step: 'transcribe', label: 'Transcribe' },
  { step: 'summarize', label: 'Summarize' },
  { step: 'pdf', label: 'Export PDF' },
  { step: 'all', label: 'Run All' },
]

interface Props {
  courses: Course[]
  selected: Selected | null
  onSelect: (course: string, lecture: string) => void
  onRun: (step: Step) => void
  inflight: boolean
}

export default function Sidebar({ courses, selected, onSelect, onRun, inflight }: Props) {
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
                    selected?.course === course.name && selected?.lecture === lecture
                  return (
                    <li key={lecture}>
                      <button
                        className={`lecture-btn${isSelected ? ' selected' : ''}`}
                        onClick={() => onSelect(course.name, lecture)}
                        dir="auto"
                      >
                        {lecture}
                      </button>

                      {isSelected && (
                        <div className="action-buttons">
                          {ACTIONS.map(({ step, label }) => (
                            <button
                              key={step}
                              className={`action-btn${step === 'all' ? ' action-btn--all' : ''}`}
                              onClick={() => onRun(step)}
                              disabled={inflight}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      )}
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
