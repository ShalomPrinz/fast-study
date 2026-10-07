import { useState } from 'react'
import type { Course, Kind, InlineEdit } from '@/types'
import { createLecture } from '@/services/database'
import { lectureNotFound } from '@/shared/utils/notFound'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { useCreateAttempt, type CreateAttempt } from '@/features/lectures/hooks/useCreateAttempt'
import { useInlineEdit } from '@/features/lectures/hooks/useInlineEdit'
import { useSelection } from '@/features/lectures/hooks/useSelection'
import { suggestName } from '@/features/lectures/utils/nextName'

export interface AddLecture {
  // null = not adding.
  target: { kind: Kind } | null
  edit: InlineEdit
  attempt: CreateAttempt
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
  const attempt = useCreateAttempt()

  function start(kind: Kind) {
    setTarget({ kind })
    edit.setValue(suggestName(courses, course.name, kind))
  }

  function cancel() {
    setTarget(null)
    edit.setValue('')
    attempt.reset()
  }

  async function commit() {
    const name = edit.value.trim()
    const t = target!
    if (!name) return cancel()
    let created = ''
    if (
      !(await attempt.run(async () => (created = await createLecture(course.name, name, t.kind))))
    )
      return
    cancel()
    // Opens the name the database created, once a tree holding it has landed, so its row is there to select.
    await refreshUntil((tree) => !lectureNotFound(tree, course.name, created, t.kind))
    onSelect(course.name, created, t.kind)
  }

  return { target, edit, attempt, start, cancel, commit }
}
