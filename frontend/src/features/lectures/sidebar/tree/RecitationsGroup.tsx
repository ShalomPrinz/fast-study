import Tooltip from '@/shared/components/Tooltip'
import { Trans, useLingui } from '@lingui/react/macro'
import { useShiftHeld } from '@/features/lectures/hooks/useShiftHeld'
import { trackProgress } from '@/features/lectures/utils/studyProgress'
import { useCourseGroup } from './CourseGroupContext'
import TreeProgress from './TreeProgress'
import { LectureListProvider } from './LectureListContext'
import LectureList from './LectureList'
import AddLectureInput from './AddLectureInput'
import '@/styles/sidebar-tree.css'
import './RecitationsGroup.css'

export default function RecitationsGroup() {
  const { t } = useLingui()
  const { course, add } = useCourseGroup()
  const shiftHeld = useShiftHeld()
  const progress = trackProgress(course.recitations)

  function startAdding(e: React.MouseEvent) {
    e.stopPropagation()
    add.start('recitation')
  }

  return (
    <li className="recitations-group">
      <div className="recitations-header">
        <span className="recitations-title" dir="auto">
          <Trans>Recitations</Trans>
        </span>
        {!shiftHeld && (
          <Tooltip content={t`Add recitation`} placement="inline-end">
            <button className="course-add-btn" onClick={startAdding} aria-label={t`Add recitation`}>
              +
            </button>
          </Tooltip>
        )}
      </div>
      {progress.total > 0 && (
        <div className="course-head-sub">
          <Trans>
            {progress.done} of {progress.total} studied
          </Trans>
        </div>
      )}
      <TreeProgress kind="recitation" done={progress.done} total={progress.total} />
      <ul className="lecture-list recitation-list">
        <LectureListProvider kind="recitation">
          <LectureList />
          <AddLectureInput />
        </LectureListProvider>
      </ul>
    </li>
  )
}
