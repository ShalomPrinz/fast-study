import { useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { createCourse } from '@/services/database'
import { useInlineEdit } from '@/features/lectures/hooks/useInlineEdit'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { useCreateAttempt } from '@/features/lectures/hooks/useCreateAttempt'
import CreateStatus from '@/features/lectures/components/CreateStatus'
import InlineEditInput from '@/features/lectures/components/InlineEditInput'
import './NewCourseRow.css'

export default function NewCourseRow() {
  const { t } = useLingui()
  const { refreshCourses } = useCourseTreeContext()
  const [addingCourse, setAddingCourse] = useState(false)
  const addCourseEdit = useInlineEdit(addingCourse || null)
  const attempt = useCreateAttempt()

  async function commit() {
    const name = addCourseEdit.value.trim()
    if (!name) return cancel()
    if (!(await attempt.run(() => createCourse(name)))) return
    close()
    await refreshCourses()
  }

  function close() {
    setAddingCourse(false)
    addCourseEdit.setValue('')
    attempt.reset()
  }

  function cancel() {
    close()
  }

  return (
    <div className="new-course-row">
      {addingCourse ? (
        <>
          <InlineEditInput
            edit={addCourseEdit}
            onCommit={commit}
            onCancel={cancel}
            placeholder={t`Course name…`}
            className="new-course-input"
          />
          <CreateStatus attempt={attempt} />
        </>
      ) : (
        <button className="new-course-btn" onClick={() => setAddingCourse(true)}>
          <span className="new-course-plus" aria-hidden="true">
            +
          </span>
          <Trans>New course</Trans>
        </button>
      )}
    </div>
  )
}
