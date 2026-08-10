import { useState } from 'react'
import type { Course, Kind, InlineEdit } from '@/types'
import { createLecture } from '@/services/database'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { useInlineEdit } from '@/features/lectures/hooks/useInlineEdit'
import { suggestName } from '@/features/lectures/utils/nextName'

export interface AddLecture {
  // null = not adding.
  target: { kind: Kind } | null
  edit: InlineEdit
  start: (kind: Kind) => void
  cancel: () => void
  commit: () => Promise<void>
}

// The add-lecture/recitation flow for one course.
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
