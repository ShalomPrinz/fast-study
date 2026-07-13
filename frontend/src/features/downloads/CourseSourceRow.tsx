import { useState } from 'react'
import type { Course } from '@/types'
import { setCourseSourceUrl } from '@/services/database'
import { useInlineEdit } from '@/features/lectures/hooks/useInlineEdit'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import InlineEditInput from '@/features/lectures/components/InlineEditInput'

// One course row: name + its source URL with inline edit (database PATCH).
export default function CourseSourceRow({ course }: { course: Course }) {
  const { refreshCourses } = useCourseTreeContext()
  const [editing, setEditing] = useState(false)
  const edit = useInlineEdit(editing ? (course.source_url ?? '') : null)

  function start() {
    setEditing(true)
    edit.setValue(course.source_url ?? '')
  }

  async function commit() {
    const url = edit.value.trim()
    setEditing(false)
    if (url === (course.source_url ?? '')) return
    await setCourseSourceUrl(course.name, url)
    await refreshCourses()
  }

  return (
    <div className="source-row">
      <span className="source-row-name" dir="auto">{course.name}</span>
      {editing ? (
        <InlineEditInput
          edit={edit}
          onCommit={commit}
          onCancel={() => setEditing(false)}
          placeholder="https://…"
          className="source-row-input"
        />
      ) : (
        <button className="source-row-url" onClick={start} title="Edit source URL" dir="auto">
          {course.source_url
            ? <span className="source-row-url-text">{course.source_url}</span>
            : <span className="source-row-url-empty">+ add source URL</span>}
        </button>
      )}
    </div>
  )
}
