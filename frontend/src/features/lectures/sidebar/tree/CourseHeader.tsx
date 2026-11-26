import { useState } from 'react'
import { useMatch, useNavigate } from 'react-router-dom'
import { Trans, useLingui } from '@lingui/react/macro'
import { renameCourse } from '@/services/database'
import { toast } from '@/services/toaster'
import { toastFailure } from '@/shared/utils/failure'
import { useSelection } from '@/features/lectures/hooks/useSelection'
import { useInlineEdit } from '@/features/lectures/hooks/useInlineEdit'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import Icon from '@/shared/components/Icon'
import Tooltip from '@/shared/components/Tooltip'
import InlineEditInput from '@/features/lectures/components/InlineEditInput'
import { trackProgress } from '@/features/lectures/utils/studyProgress'
import { lectureTrack } from '@/features/lectures/utils/courseTree'
import { isCourseRenameLocked } from '@/features/lectures/utils/renameLock'
import { renameAndFollow } from '@/features/lectures/utils/renameFlow'
import { renameFollowTarget } from '@/features/lectures/utils/renameFollow'
import { courseNotFound } from '@/shared/utils/notFound'
import { useRunnerStatus } from '@/shared/contexts/RunnerStatusContext'
import { useCourseDownloading } from '@/features/downloads/contexts/DownloadJobsContext'
import { ROUTES, routeParam } from '@/shared/utils/routes'
import { useCourseGroup } from './CourseGroupContext'
import TreeProgress from './TreeProgress'
import '@/styles/sidebar-tree.css'
import './CourseHeader.css'

// Frozen at the top of the pane while the tree scrolls; the title row swaps the pane to the course list.
export default function CourseHeader({ onSwitch }: { onSwitch: () => void }) {
  const { t } = useLingui()
  const { course, add, onRenamed } = useCourseGroup()
  const { selected, onSelect } = useSelection()
  const { refreshUntil } = useCourseTreeContext()
  const { status } = useRunnerStatus()
  const downloading = useCourseDownloading(course.name)
  const navigate = useNavigate()
  const overviewOpen = routeParam(useMatch(ROUTES.overview)?.params.course) === course.name
  const assignmentMatch = useMatch(ROUTES.assignment)
  const openAssignment =
    assignmentMatch && routeParam(assignmentMatch.params.course) === course.name
      ? routeParam(assignmentMatch.params.assignment)
      : null
  const mergedOpen = routeParam(useMatch(ROUTES.merged)?.params.course) === course.name
  const mergedNewOpen = routeParam(useMatch(ROUTES.mergedNew)?.params.course) === course.name
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
          onRenamed(course.name, effective)
          return effective
        },
        refresh: (effective) => refreshUntil((tree) => !courseNotFound(tree, effective)),
        // The database may sanitize the typed name, so the page follows the folder it answers with.
        follow: (effective) => {
          const target = renameFollowTarget(course.name, effective, {
            selected,
            overviewOpen,
            openAssignment,
            mergedOpen,
            mergedNewOpen,
          })
          if (target?.type === 'lecture') {
            onSelect(effective, target.lecture, target.kind, { replace: true })
          } else if (target) navigate(target.to, { replace: true })
        },
        show: setPendingName,
      })
    } catch (e) {
      toastFailure(e)
    }
  }

  function startAdding(e: React.MouseEvent) {
    e.stopPropagation()
    add.start('lecture')
  }

  return (
    <div className="pane-sticky-head">
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
          <Tooltip placement="inline-end" content={t`Switch course`}>
            <button
              className="course-toggle course-toggle--head"
              onClick={(e) => {
                if (e.shiftKey) {
                  if (!renameLocked) startRenaming(e)
                  else {
                    e.preventDefault()
                    toast(
                      'info',
                      t`Can't rename while something in this course is being processed, downloaded or generated`,
                    )
                  }
                } else onSwitch()
              }}
            >
              <span className="course-head-title">
                <span className="course-switch-icon">
                  <Icon icon="chevrons-up-down" />
                </span>
                <span className="course-name" dir="auto">
                  {pendingName ?? course.name}
                </span>
              </span>
              {progress.total > 0 && (
                <Tooltip
                  content={renameLocked ? undefined : t`Lectures you marked done`}
                  placement="inline-end"
                >
                  <span className="course-head-sub">
                    <Trans>
                      {progress.done} of {progress.total} studied
                    </Trans>
                  </span>
                </Tooltip>
              )}
              <span className="tree-visually-hidden">{t`Switch course`}</span>
            </button>
          </Tooltip>
        )}
        {!renaming && (
          <Tooltip content={t`Add lecture`} placement="inline-end">
            <button className="course-add-btn" onClick={startAdding} aria-label={t`Add lecture`}>
              +
            </button>
          </Tooltip>
        )}
      </div>
      {!renaming && <TreeProgress kind="lecture" done={progress.done} total={progress.total} />}
    </div>
  )
}
