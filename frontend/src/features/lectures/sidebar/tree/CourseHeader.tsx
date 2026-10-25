import { useState } from 'react'
import { useMatch, useNavigate } from 'react-router-dom'
import { useLingui } from '@lingui/react/macro'
import type { ExpandHandle } from '@/types'
import { renameCourse, setCourseArchived } from '@/services/database'
import { toastFailure } from '@/shared/utils/failure'
import { useSelection } from '@/features/lectures/hooks/useSelection'
import { useShiftHeld } from '@/features/lectures/hooks/useShiftHeld'
import { useInlineEdit } from '@/features/lectures/hooks/useInlineEdit'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import Icon from '@/shared/components/Icon'
import Tooltip from '@/shared/components/Tooltip'
import InlineEditInput from '@/features/lectures/components/InlineEditInput'
import { trackProgress } from '@/features/lectures/utils/studyProgress'
import { lectureTrack } from '@/features/lectures/utils/courseTree'
import { isCourseRenameLocked } from '@/features/lectures/utils/renameLock'
import { renameAndFollow } from '@/features/lectures/utils/renameFlow'
import { courseNotFound } from '@/shared/utils/notFound'
import { moveSavedExpansion } from '@/features/lectures/utils/courseExpansion'
import { useRunnerStatus } from '@/shared/contexts/RunnerStatusContext'
import { useCourseDownloading } from '@/features/downloads/contexts/DownloadJobsContext'
import { ROUTES, routeParam } from '@/shared/utils/routes'
import { assignmentRoute, courseRoute } from '@/shared/utils/url'
import { useCourseGroup } from './CourseGroupContext'
import '@/styles/sidebar-tree.css'
import './CourseHeader.css'
import Chevron from '@/shared/components/Chevron'

// Reflects and mutates the expand state: toggle on click, open when adding a lecture.
export default function CourseHeader({ expand }: { expand: ExpandHandle }) {
  const { t } = useLingui()
  const { course, add } = useCourseGroup()
  const { selected, onSelect } = useSelection()
  const { refreshCourses, refreshUntil } = useCourseTreeContext()
  const shiftHeld = useShiftHeld()
  const { status } = useRunnerStatus()
  const downloading = useCourseDownloading(course.name)
  const navigate = useNavigate()
  const overviewOpen = routeParam(useMatch(ROUTES.overview)?.params.course) === course.name
  const assignmentMatch = useMatch(ROUTES.assignment)
  const openAssignment =
    assignmentMatch && routeParam(assignmentMatch.params.course) === course.name
      ? routeParam(assignmentMatch.params.assignment)
      : null
  // A course rename moves every lecture folder, so anything writing into it by name locks it.
  const renameLocked = isCourseRenameLocked(status, course.name) || downloading

  const [renaming, setRenaming] = useState(false)
  const [pendingName, setPendingName] = useState<string | null>(null)
  const renameEdit = useInlineEdit(renaming ? course.name : null)
  const progress = trackProgress(lectureTrack(course))

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
    try {
      await renameAndFollow({
        typed: name,
        rename: async () => {
          const effective = await renameCourse(course.name, name)
          // Before the refreshed tree remounts the group under its new name.
          moveSavedExpansion(course.name, effective)
          return effective
        },
        refresh: (effective) => refreshUntil((tree) => !courseNotFound(tree, effective)),
        // The database may sanitize the typed name, so the page follows the folder it answers with.
        follow: (effective) => {
          if (selected?.course === course.name) {
            onSelect(effective, selected.lecture, selected.kind)
          } else if (overviewOpen) {
            navigate(courseRoute(effective))
          } else if (openAssignment !== null) {
            navigate(assignmentRoute(effective, openAssignment))
          }
        },
        show: setPendingName,
      })
    } catch (e) {
      toastFailure(e)
    }
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
        <Tooltip
          placement="inline-end"
          content={
            renameLocked
              ? t`Can't rename while something in this course is being processed, downloaded or generated`
              : undefined
          }
        >
          <button
            className="course-toggle"
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
              {pendingName ?? course.name}
            </span>
            {!course.archived && progress.total > 0 && (
              <Tooltip
                content={renameLocked ? undefined : t`Lectures you marked done`}
                placement="inline-end"
              >
                <span className="course-count">
                  {progress.done}/{progress.total}
                </span>
              </Tooltip>
            )}
          </button>
        </Tooltip>
      )}
      {!renaming &&
        (shiftHeld ? (
          <Tooltip
            content={course.archived ? t`Unarchive course` : t`Archive course`}
            placement="inline-end"
          >
            <button
              className="course-add-btn course-archive-btn"
              onClick={toggleArchived}
              aria-label={course.archived ? t`Unarchive course` : t`Archive course`}
            >
              <Icon icon={course.archived ? 'unarchive' : 'archive'} />
            </button>
          </Tooltip>
        ) : (
          <Tooltip content={t`Add lecture`} placement="inline-end">
            <button className="course-add-btn" onClick={startAdding} aria-label={t`Add lecture`}>
              +
            </button>
          </Tooltip>
        ))}
    </div>
  )
}
