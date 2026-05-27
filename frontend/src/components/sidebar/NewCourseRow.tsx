import { useState } from 'react'
import { createCourse } from '../../services/database'
import { useInlineEdit } from '../../hooks/useInlineEdit'
import { useCourseTreeContext } from '../../contexts/CourseTreeContext'
import InlineEditInput from '../InlineEditInput'

export default function NewCourseRow() {
  const { refreshCourses } = useCourseTreeContext()
  const [addingCourse, setAddingCourse] = useState(false)
  const addCourseEdit = useInlineEdit(addingCourse || null)

  async function commit() {
    const name = addCourseEdit.value.trim()
    setAddingCourse(false)
    addCourseEdit.setValue('')
    if (!name) return
    await createCourse(name)
    await refreshCourses()
  }

  function cancel() {
    setAddingCourse(false)
    addCourseEdit.setValue('')
  }

  return (
    <div className="new-course-row">
      {addingCourse ? (
        <InlineEditInput
          edit={addCourseEdit}
          onCommit={commit}
          onCancel={cancel}
          placeholder="Course name…"
          className="new-course-input"
        />
      ) : (
        <button className="new-course-btn" onClick={() => setAddingCourse(true)}>
          + New Course
        </button>
      )}
    </div>
  )
}
