import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import type { Lecture } from '@/types'
import { renameLecture } from '@/services/database'
import { toastFailure } from '@/shared/utils/failure'
import { toast } from '@/services/toaster'
import { useSelection } from '@/features/lectures/hooks/useSelection'
import { useInlineEdit } from '@/features/lectures/hooks/useInlineEdit'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { useRunnerStatus } from '@/shared/contexts/RunnerStatusContext'
import { useDriveEnabled } from '@/shared/contexts/SettingsContext'
import { findLecture } from '@/features/lectures/utils/courseTree'
import { isLectureComplete } from '@/features/lectures/utils/lectureProgress'
import { isLectureRenameLocked } from '@/features/lectures/utils/renameLock'
import { renameAndFollow } from '@/features/lectures/utils/renameFlow'
import InlineEditInput from '@/features/lectures/components/InlineEditInput'
import { usePendingUpload } from '@/features/lectures/sidebar/PendingUploadModal'
import { useCourseGroup } from './CourseGroupContext'
import { useLectureListKind } from './LectureListContext'
import '@/styles/sidebar-tree.css'

export default function LectureItem({ lecture }: { lecture: Lecture }) {
  const { t } = useLingui()
  const { course } = useCourseGroup()
  const kind = useLectureListKind()
  const { selected, onSelect } = useSelection()
  const { courses, refreshCourses } = useCourseTreeContext()
  const { status, isInFlight } = useRunnerStatus()
  const driveEnabled = useDriveEnabled()
  const upload = usePendingUpload()

  const [renaming, setRenaming] = useState(false)
  const [pendingName, setPendingName] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const renameEdit = useInlineEdit(renaming ? lecture.name : null)

  const isSelected =
    selected?.course === course.name &&
    selected?.lecture === lecture.name &&
    selected?.kind === kind

  const running = isInFlight(course.name, lecture.name, kind)
  const renameLocked = isLectureRenameLocked(status, course.name, lecture.name, kind)
  const dotState = isLectureComplete(lecture, driveEnabled) ? 'done' : running ? 'running' : null

  function startRenaming(e: React.MouseEvent) {
    e.preventDefault()
    setRenaming(true)
    renameEdit.setValue(lecture.name)
  }

  async function commitRename() {
    const name = renameEdit.value.trim()
    setRenaming(false)
    renameEdit.setValue('')
    // A run may have started while the input was open.
    if (!name || name === lecture.name || renameLocked) return
    try {
      await renameAndFollow({
        typed: name,
        rename: () => renameLecture(course.name, lecture.name, name, kind),
        refresh: refreshCourses,
        // The database may sanitize the typed name, so the page follows the folder it answers with.
        follow: (effective) => {
          if (isSelected) onSelect(course.name, effective, kind)
        },
        show: setPendingName,
      })
    } catch (e) {
      toastFailure(e)
    }
  }

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
    if (found?.files['video.mp4'].exists) {
      upload.confirm(course.name, lecture.name, file, kind)
    } else {
      upload.trigger(course.name, lecture.name, file, kind)
    }
  }

  if (renaming) {
    return (
      <li>
        <InlineEditInput
          edit={renameEdit}
          onCommit={commitRename}
          onCancel={() => {
            setRenaming(false)
            renameEdit.setValue('')
          }}
        />
      </li>
    )
  }

  return (
    <li>
      <button
        className={`lecture-btn${isSelected ? ' selected' : ''}${dragOver ? ' drag-over' : ''}`}
        data-testid="lecture"
        data-course={course.name}
        data-lecture={lecture.name}
        data-kind={kind}
        title={
          renameLocked ? t`Can't rename while it's being processed or waiting in line` : undefined
        }
        onClick={(e) => {
          if (e.shiftKey) {
            if (!renameLocked) startRenaming(e)
            else e.preventDefault()
          } else onSelect(course.name, lecture.name, kind)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <span className={`lecture-dot${dotState ? ` lecture-dot--${dotState}` : ''}`} />
        <span className="lecture-name" dir="auto">
          {pendingName ?? lecture.name}
        </span>
      </button>
    </li>
  )
}
