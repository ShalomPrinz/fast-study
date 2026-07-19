import InlineEditInput from '@/features/lectures/components/InlineEditInput'
import { useCourseGroup } from './CourseGroupContext'
import { useLectureListKind } from './LectureListContext'

// Renders only in the list whose kind is being added, so the two lists never both show it.
export default function AddLectureInput() {
  const { add } = useCourseGroup()
  const kind = useLectureListKind()
  if (add.target?.kind !== kind) return null

  return (
    <li>
      <InlineEditInput
        edit={add.edit}
        onCommit={add.commit}
        onCancel={add.cancel}
        placeholder={kind === 'recitation' ? 'Recitation name…' : 'Lecture name…'}
      />
    </li>
  )
}
