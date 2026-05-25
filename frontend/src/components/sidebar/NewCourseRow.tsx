import type { InlineEdit } from '../../types'
import InlineEditInput from '../InlineEditInput'

interface Props {
  addingCourse: boolean
  addCourseEdit: InlineEdit
  onStart: () => void
  onCommit: () => void
  onCancel: () => void
}

export default function NewCourseRow({ addingCourse, addCourseEdit, onStart, onCommit, onCancel }: Props) {
  return (
    <div className="new-course-row">
      {addingCourse ? (
        <InlineEditInput
          edit={addCourseEdit}
          onCommit={onCommit}
          onCancel={onCancel}
          placeholder="Course name…"
          className="new-course-input"
        />
      ) : (
        <button className="new-course-btn" onClick={onStart}>
          + New Course
        </button>
      )}
    </div>
  )
}
