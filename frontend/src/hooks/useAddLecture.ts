import { useState } from 'react'
import type { Course, Kind, InlineEdit } from '@/types'
import { createLecture } from '@/services/database'
import { useCourseTreeContext } from '@/contexts/CourseTreeContext'
import { useInlineEdit } from '@/hooks/useInlineEdit'
import { suggestName } from '@/utils/namingSuggestion'

export interface AddLecture {
  // Which kind of item is currently being added (null = not adding).
  target: { kind: Kind } | null
  edit: InlineEdit
  start: (kind: Kind) => void
  cancel: () => void
  commit: () => Promise<void>
}

// add-lecture/recitation flow scoped to one course: which kind is being added, inline-edit buffer, and commit/cancel.
export function useAddLecture(course: Course): AddLecture {
  const { courses, refreshCourses } = useCourseTreeContext()
  const [target, setTarget] = useState<{ kind: Kind } | null>(null)
  const edit = useInlineEdit(target ? `${course.name}::${target.kind}` : null)

  function start(kind: Kind) {
    setTarget({ kind })
    edit.setValue(suggestName(courses, course.name, kind))
  }

  function cancel() {
    setTarget(null)
    edit.setValue('')
  }

  async function commit() {
    const name = edit.value.trim()
    const t = target!
    setTarget(null)
    edit.setValue('')
    if (!name) return
    await createLecture(course.name, name, t.kind)
    refreshCourses()
  }

  return { target, edit, start, cancel, commit }
}
