import type { RefObject } from 'react'

interface InlineEdit {
  value: string
  setValue: (v: string) => void
  ref: RefObject<HTMLInputElement>
}

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
        <input
          ref={addCourseEdit.ref}
          className="new-course-input"
          value={addCourseEdit.value}
          onChange={(e) => addCourseEdit.setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommit()
            if (e.key === 'Escape') onCancel()
          }}
          onBlur={onCancel}
          placeholder="Course name…"
          dir="auto"
        />
      ) : (
        <button className="new-course-btn" onClick={onStart}>
          + New Course
        </button>
      )}
    </div>
  )
}
