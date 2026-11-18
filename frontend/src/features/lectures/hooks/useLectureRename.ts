import { useState } from 'react'
import type { Kind } from '@/types'
import { renameLecture } from '@/services/database'
import { toastFailure } from '@/shared/utils/failure'
import { useSelection } from '@/features/lectures/hooks/useSelection'
import { useInlineEdit } from '@/features/lectures/hooks/useInlineEdit'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { useRunnerStatus } from '@/shared/contexts/RunnerStatusContext'
import { isLectureRenameLocked } from '@/features/lectures/utils/renameLock'
import { renameAndFollow } from '@/features/lectures/utils/renameFlow'
import { lectureNotFound } from '@/shared/utils/notFound'

// One lecture's inline rename, shared by the sidebar row and the page title. `follow` is whether the
// open page is this lecture, so the route moves to the renamed folder.
export function useLectureRename(course: string, lecture: string, kind: Kind, follow: boolean) {
  const { onSelect } = useSelection()
  const { refreshUntil } = useCourseTreeContext()
  const { status } = useRunnerStatus()
  const [renaming, setRenaming] = useState(false)
  const [pendingName, setPendingName] = useState<string | null>(null)
  const edit = useInlineEdit(renaming ? lecture : null)
  // Running or queued: a run would finish from the old folder over the new one.
  const locked = isLectureRenameLocked(status, course, lecture, kind)

  function start() {
    if (locked) return
    setRenaming(true)
    edit.setValue(lecture)
  }

  function cancel() {
    setRenaming(false)
    edit.setValue('')
  }

  async function commit() {
    const name = edit.value.trim()
    cancel()
    // A run may have started while the input was open.
    if (!name || name === lecture || locked) return
    try {
      await renameAndFollow({
        typed: name,
        rename: () => renameLecture(course, lecture, name, kind),
        refresh: (effective) =>
          refreshUntil((tree) => !lectureNotFound(tree, course, effective, kind)),
        // The database may sanitize the typed name, so the page follows the folder it answers with.
        follow: (effective) => {
          if (follow) onSelect(course, effective, kind, { replace: true })
        },
        show: setPendingName,
      })
    } catch (e) {
      toastFailure(e)
    }
  }

  return { renaming, edit, locked, pendingName, actions: { start, cancel, commit } }
}
