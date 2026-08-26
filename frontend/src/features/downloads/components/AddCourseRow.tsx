import { useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { createCourse } from '@/services/database'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import '@/styles/source-row.css'
import '@/styles/button.css'
import './AddCourseRow.css'

// Plain inputs, not InlineEditInput: moving between the name and URL fields must not blur-cancel.
export default function AddCourseRow() {
  const { t } = useLingui()
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
        <Trans>+ New Course</Trans>
      </button>
    )
  }

  return (
    <div className="source-add-row">
      <input
        className="source-row-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') reset()
        }}
        placeholder={t`Course name…`}
        dir="auto"
        autoFocus
      />
      <input
        className="source-row-input"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') reset()
        }}
        placeholder={t`Source URL (optional)…`}
        dir="auto"
      />
      <div className="source-add-actions">
        <button className="btn btn--primary" onClick={commit} disabled={saving || !name.trim()}>
          <Trans>Create</Trans>
        </button>
        <button className="btn btn--ghost" onClick={reset}>
          <Trans>Cancel</Trans>
        </button>
      </div>
    </div>
  )
}
