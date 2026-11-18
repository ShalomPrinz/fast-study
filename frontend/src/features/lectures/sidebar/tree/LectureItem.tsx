import Tooltip from '@/shared/components/Tooltip'
import { useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { toast } from '@/services/toaster'
import { useLectureRename } from '@/features/lectures/hooks/useLectureRename'
import { useSelection } from '@/features/lectures/hooks/useSelection'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import {
  findLecture,
  lectureTrack,
  recitationTrack,
  type TrackItem,
} from '@/features/lectures/utils/courseTree'
import { useRunnerStatus } from '@/shared/contexts/RunnerStatusContext'
import { isLectureRunning } from '@/features/lectures/utils/renameLock'
import { holdsFile } from '@/features/lectures/utils/lectureProgress'
import { trackProgress } from '@/features/lectures/utils/studyProgress'
import Icon from '@/shared/components/Icon'
import InlineEditInput from '@/features/lectures/components/InlineEditInput'
import { usePendingUpload } from '@/features/lectures/sidebar/PendingUploadModal'
import { useCourseGroup } from './CourseGroupContext'
import { useLectureListKind } from './LectureListContext'
import '@/styles/spinner.css'
import '@/styles/sidebar-tree.css'

export default function LectureItem({
  lecture,
  timeline = '',
}: {
  lecture: TrackItem
  timeline?: string
}) {
  const { t } = useLingui()
  const { course } = useCourseGroup()
  const list = useLectureListKind()
  const { kind } = lecture
  const { selected, onSelect } = useSelection()
  const { courses } = useCourseTreeContext()
  const upload = usePendingUpload()
  const { status } = useRunnerStatus()

  const [dragOver, setDragOver] = useState(false)

  const isSelected =
    selected?.course === course.name &&
    selected?.lecture === lecture.name &&
    selected?.kind === kind

  const rename = useLectureRename(course.name, lecture.name, kind, isSelected)
  // The same set that locks a rename is the one the mark gives way to a spinner for.
  const renameLocked = rename.locked
  const pendingName = rename.pendingName
  // Only a lecture being worked on is labelled; one waiting in line shows the spinner alone.
  const processing = isLectureRunning(status, course.name, lecture.name, kind)
  const current = trackProgress(
    list === 'recitation' ? recitationTrack(course) : lectureTrack(course),
  ).current
  const mark = lecture.done
    ? 'done'
    : current?.name === lecture.name && current.kind === kind
      ? 'current'
      : 'todo'

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    // Same lock as rename: a run on this lecture would finish from the old video over the new one.
    if (renameLocked) {
      toast('error', t`Can't replace the video while it's being processed or waiting in line`)
      return
    }
    if (!file.name.toLowerCase().endsWith('.mp4') && file.type !== 'video/mp4') {
      toast('error', t`Only .mp4 files are allowed`)
      return
    }
    const found = findLecture(courses, course.name, lecture.name, kind)
    // A removed video still confirms: the upload wipes the transcript and summary made from it.
    if (found && holdsFile(found, 'video.mp4')) {
      upload.confirm(course.name, lecture.name, file, kind)
    } else {
      upload.trigger(course.name, lecture.name, file, kind)
    }
  }

  if (rename.renaming) {
    return (
      <li className={timeline}>
        <InlineEditInput
          edit={rename.edit}
          onCommit={rename.actions.commit}
          onCancel={rename.actions.cancel}
        />
      </li>
    )
  }

  return (
    <li className={timeline}>
      <Tooltip
        content={
          renameLocked ? t`Can't rename while it's being processed or waiting in line` : undefined
        }
        placement="inline-end"
      >
        <button
          className={`lecture-btn${isSelected ? ' selected' : ''}${dragOver ? ' drag-over' : ''}`}
          data-testid="lecture"
          data-course={course.name}
          data-lecture={lecture.name}
          data-kind={kind}
          onClick={(e) => {
            if (e.shiftKey) {
              e.preventDefault()
              rename.actions.start()
            } else onSelect(course.name, lecture.name, kind)
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <span className={`lecture-mark lecture-mark--${renameLocked ? 'busy' : mark}`}>
            {renameLocked ? (
              <span className="spinner lecture-mark-spinner" />
            ) : mark === 'done' ? (
              <Icon icon="check" />
            ) : null}
          </span>
          <span className="lecture-name" dir="auto">
            {pendingName ?? lecture.name}
          </span>
          {processing && (
            <span className="lecture-status">
              <Trans>Processing</Trans>
            </span>
          )}
        </button>
      </Tooltip>
    </li>
  )
}
