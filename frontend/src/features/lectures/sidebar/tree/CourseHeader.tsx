import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import type { ExpandHandle } from '@/types'
import { renameCourse, setCourseArchived } from '@/services/database'
import { toastFailure } from '@/shared/utils/failure'
import { useSelection } from '@/features/lectures/hooks/useSelection'
import { useShiftHeld } from '@/features/lectures/hooks/useShiftHeld'
import { useInlineEdit } from '@/features/lectures/hooks/useInlineEdit'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { useDriveEnabled } from '@/shared/contexts/SettingsContext'
import Icon from '@/shared/components/Icon'
import InlineEditInput from '@/features/lectures/components/InlineEditInput'
import { courseProgress } from '@/features/lectures/utils/lectureProgress'
import { isCourseRenameLocked } from '@/features/lectures/utils/renameLock'
import { useRunnerStatus } from '@/shared/contexts/RunnerStatusContext'
import { useCourseGroup } from './CourseGroupContext'
import '@/styles/sidebar-tree.css'
import './CourseHeader.css'
import Chevron from '@/shared/components/Chevron'

// Reflects and mutates the expand state: toggle on click, open when adding a lecture.
export default function CourseHeader({ expand }: { expand: ExpandHandle }) {
  const { t } = useLingui()
  const { course, add } = useCourseGroup()
  const { selected, onSelect } = useSelection()
  const { refreshCourses } = useCourseTreeContext()
  const driveEnabled = useDriveEnabled()
  const shiftHeld = useShiftHeld()
  const { status } = useRunnerStatus()
  // A course rename moves every lecture folder, so one running or queued lecture locks it.
  const renameLocked = isCourseRenameLocked(status, course.name)

  const [renaming, setRenaming] = useState(false)
  const renameEdit = useInlineEdit(renaming ? course.name : null)
  const progress = courseProgress(course, driveEnabled)

  function startRenaming(e: React.MouseEvent) {
    e.preventDefault()
    setRenaming(true)
    renameEdit.setValue(course.name)
  }

  async function commitRename() {
    const name = renameEdit.value.trim()
    setRenaming(false)
    renameEdit.setValue('')
    // A run may have started while the input was open.
    if (!name || name === course.name || renameLocked) return
    let effective: string
    try {
      effective = await renameCourse(course.name, name)
    } catch (e) {
      toastFailure(e)
      return
    }
    // The database may sanitize the typed name, so the page follows the folder it answers with.
    if (selected?.course === course.name) {
      onSelect(effective, selected.lecture, selected.kind)
    }
    refreshCourses()
  }

  function startAdding(e: React.MouseEvent) {
    e.stopPropagation()
    expand.open()
    add.start('lecture')
  }

  async function toggleArchived(e: React.MouseEvent) {
    e.stopPropagation()
    try {
      await setCourseArchived(course.name, !course.archived)
    } catch (err) {
      toastFailure(err)
      return
    }
    refreshCourses()
  }

  return (
    <div className="course-header">
      {renaming ? (
        <InlineEditInput
          edit={renameEdit}
          onCommit={commitRename}
          onCancel={() => {
            setRenaming(false)
            renameEdit.setValue('')
          }}
        />
      ) : (
        <button
          className="course-toggle"
          title={
            renameLocked
              ? t`Can't rename while one of its lectures is being processed or waiting in line`
              : undefined
          }
          onClick={(e) => {
            if (e.shiftKey) {
              if (!renameLocked) startRenaming(e)
              else e.preventDefault()
            } else expand.toggle()
          }}
        >
          <span className="chevron">
            <Chevron open={expand.isOpen} />
          </span>
          <span className="course-name" dir="auto">
            {course.name}
          </span>
          {progress.total > 0 && (
            <span className="course-count" title={t`Fully processed lectures`}>
              {progress.complete}/{progress.total}
            </span>
          )}
        </button>
      )}
      {!renaming &&
        (shiftHeld ? (
          <button
            className="course-add-btn course-archive-btn"
            onClick={toggleArchived}
            title={course.archived ? t`Unarchive course` : t`Archive course`}
          >
            <Icon icon={course.archived ? 'unarchive' : 'archive'} />
          </button>
        ) : (
          <button className="course-add-btn" onClick={startAdding} title={t`Add lecture`}>
            +
          </button>
        ))}
    </div>
  )
}
