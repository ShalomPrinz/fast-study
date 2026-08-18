import { Trans, useLingui } from '@lingui/react/macro'
import type { ExpandHandle } from '@/types'
import { useShiftHeld } from '@/features/lectures/hooks/useShiftHeld'
import { useCourseGroup } from './CourseGroupContext'
import { LectureListProvider } from './LectureListContext'
import LectureList from './LectureList'
import AddLectureInput from './AddLectureInput'
import '@/styles/sidebar-tree.css'
import './RecitationsGroup.css'

// `expand` is owned by CourseGroup, so this stays open across a course collapse/re-expand.
export default function RecitationsGroup({ expand }: { expand: ExpandHandle }) {
  const { t } = useLingui()
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
        <button className="course-toggle recitations-toggle" onClick={expand.toggle} dir="auto">
          <span className="chevron">{expand.isOpen ? '▾' : '▸'}</span>
          <span>
            <Trans>Recitations</Trans>
          </span>
        </button>
        {!shiftHeld && (
          <button className="course-add-btn" onClick={startAdding} title={t`Add recitation`}>
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
