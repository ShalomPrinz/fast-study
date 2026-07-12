import type { ExpandHandle } from '@/types'
import { useShiftHeld } from '@/features/lectures/hooks/useShiftHeld'
import { useCourseGroup } from './CourseGroupContext'
import { LectureListProvider } from './LectureListContext'
import LectureList from './LectureList'
import AddLectureInput from './AddLectureInput'

// The recitations sub-group. Its open-state (`expand`) is owned by CourseGroup so it
// survives collapsing/re-expanding the course.
export default function RecitationsGroup({ expand }: { expand: ExpandHandle }) {
  const { add } = useCourseGroup()
  const shiftHeld = useShiftHeld()

  function startAdding(e: React.MouseEvent) {
    e.stopPropagation()
    expand.open()
    add.start('recitation')
  }

  return (
    <li className="recitations-group">
      <div className="recitations-header">
        <button
          className="course-toggle recitations-toggle"
          onClick={expand.toggle}
          dir="auto"
        >
          <span className="chevron">{expand.isOpen ? '▾' : '▸'}</span>
          <span>Recitations</span>
        </button>
        {!shiftHeld && (
          <button
            className="course-add-btn"
            onClick={startAdding}
            title="Add recitation"
          >
            +
          </button>
        )}
      </div>
      {expand.isOpen && (
        <ul className="lecture-list recitation-list">
          <LectureListProvider kind="recitation">
            <LectureList />
            <AddLectureInput />
          </LectureListProvider>
        </ul>
      )}
    </li>
  )
}
