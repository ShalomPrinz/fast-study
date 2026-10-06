import { useState } from 'react'
import type { Course, Kind, InlineEdit } from '@/types'
import { createLecture } from '@/services/database'
import { toastFailure } from '@/shared/utils/failure'
import { lectureNotFound } from '@/shared/utils/notFound'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { useInlineEdit } from '@/features/lectures/hooks/useInlineEdit'
import { useSelection } from '@/features/lectures/hooks/useSelection'
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
  const { courses, refreshUntil } = useCourseTreeContext()
  const { onSelect } = useSelection()
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
    let created: string
    try {
      created = await createLecture(course.name, name, t.kind)
    } catch (e) {
      toastFailure(e)
      return
    }
    // Opens the name the database created, once a tree holding it has landed, so its row is there to select.
    await refreshUntil((tree) => !lectureNotFound(tree, course.name, created, t.kind))
    onSelect(course.name, created, t.kind)
  }

  return { target, edit, start, cancel, commit }
}
