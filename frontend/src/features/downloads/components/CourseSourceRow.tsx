import { useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import type { Course } from '@/types'
import { setCourseSourceUrl } from '@/services/database'
import { useInlineEdit } from '@/features/lectures/hooks/useInlineEdit'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import InlineEditInput from '@/features/lectures/components/InlineEditInput'
import Icon from '@/shared/components/Icon'
import '@/styles/source-row.css'
import './CourseSourceRow.css'

interface Props {
  course: Course
  onDiscover?: () => void
  selected?: boolean
  discovering?: boolean
}

// One course row: name + source URL (a real link once set, pencil to edit) + Load recordings.
// With no URL there's nothing to link to, so "+ add source URL" opens edit mode directly.
export default function CourseSourceRow({ course, onDiscover, selected, discovering }: Props) {
  const { t } = useLingui()
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
    <div className={selected ? 'source-row source-row--selected' : 'source-row'}>
      <span className="source-row-name" title={course.name} dir="auto">
        {course.name}
      </span>
      {editing ? (
        <InlineEditInput
          edit={edit}
          onCommit={commit}
          onCancel={() => setEditing(false)}
          placeholder="https://…"
          className="source-row-input"
        />
      ) : course.source_url ? (
        <a
          className="source-row-url-text"
          href={course.source_url}
          target="_blank"
          rel="noopener noreferrer"
          title={course.source_url}
          dir="auto"
        >
          {course.source_url}
        </a>
      ) : (
        <button className="source-row-url" onClick={start} dir="auto">
          <Trans>+ add source URL</Trans>
        </button>
      )}
      {!editing && course.source_url && (
        <div className="source-row-actions">
          {onDiscover && (
            <button
              className="source-row-btn source-row-btn--ghost"
              onClick={onDiscover}
              disabled={discovering}
            >
              {discovering ? t`Loading…` : t`Load recordings`}
            </button>
          )}
          <button className="source-row-edit-btn" onClick={start} title={t`Edit source URL`}>
            <Icon icon="edit" />
          </button>
        </div>
      )}
    </div>
  )
}
