import { useState } from 'react'
import { createCourse } from '@/services/database'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'

// Add-course row: creates the same DATA_ROOT course the pipeline uses, seeded
// with an optional source URL. Uses plain inputs (not InlineEditInput) so moving
// between the name and URL fields doesn't blur-cancel the entry.
export default function AddCourseRow() {
  const { refreshCourses } = useCourseTreeContext()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [saving, setSaving] = useState(false)

  function reset() {
    setAdding(false)
    setName('')
    setUrl('')
  }

  async function commit() {
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      await createCourse(trimmed, url.trim())
      await refreshCourses()
      reset()
    } finally {
      setSaving(false)
    }
  }

  if (!adding) {
    return (
      <button className="source-add-btn" onClick={() => setAdding(true)}>
        + New Course
      </button>
    )
  }

  return (
    <div className="source-add-row">
      <input
        className="source-row-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') reset() }}
        placeholder="Course name…"
        dir="auto"
        autoFocus
      />
      <input
        className="source-row-input"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') reset() }}
        placeholder="Source URL (optional)…"
        dir="auto"
      />
      <div className="source-add-actions">
        <button className="source-row-btn" onClick={commit} disabled={saving || !name.trim()}>Create</button>
        <button className="source-row-btn source-row-btn--ghost" onClick={reset}>Cancel</button>
      </div>
    </div>
  )
}
