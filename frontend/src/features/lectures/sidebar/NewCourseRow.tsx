import { useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { createCourse } from '@/services/database'
import { useInlineEdit } from '@/features/lectures/hooks/useInlineEdit'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { useCreateAttempt } from '@/features/lectures/hooks/useCreateAttempt'
import CreateStatus from '@/features/lectures/components/CreateStatus'
import InlineEditInput from '@/features/lectures/components/InlineEditInput'
import './NewCourseRow.css'

export default function NewCourseRow({ onCreated }: { onCreated: (name: string) => void }) {
  const { t } = useLingui()
  const { refreshCourses } = useCourseTreeContext()
  const [addingCourse, setAddingCourse] = useState(false)
  const addCourseEdit = useInlineEdit(addingCourse || null, { yieldFocus: true })
  const attempt = useCreateAttempt()

  async function commit() {
    const name = addCourseEdit.value.trim()
    if (!name) return cancel()
    if (attempt.running()) return
    let created = ''
    const ok = await attempt.run(async () => {
      created = await createCourse(name)
    })
    if (!ok) return setAddingCourse(true)
    close()
    onCreated(created)
    await refreshCourses()
  }

  function close() {
    setAddingCourse(false)
    addCourseEdit.setValue('')
    attempt.reset()
  }

  // A blur or Escape while a create runs only hides the input: the create finishes, and a refusal reopens it.
  function cancel() {
    if (attempt.running()) return setAddingCourse(false)
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
