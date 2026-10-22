import { Trans, useLingui } from '@lingui/react/macro'
import type { Kind } from '@/types'
import { setLectureDone } from '@/services/database'
import { toastFailure } from '@/shared/utils/failure'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import Icon from '@/shared/components/Icon'
import Tooltip from '@/shared/components/Tooltip'
import '@/styles/button.css'

// The lecture page's study toggle: marks it done, and once done offers to revert it. It needs no
// summary or pipeline state, so it is always enabled.
export default function StudyDoneButton({
  course,
  lecture,
  kind,
  done,
}: {
  course: string
  lecture: string
  kind: Kind
  done: boolean
}) {
  const { t } = useLingui()
  const { refreshCourses } = useCourseTreeContext()

  async function toggle() {
    try {
      await setLectureDone(course, lecture, !done, kind)
    } catch (e) {
      toastFailure(e)
      return
    }
    refreshCourses()
  }

  const revertHint =
    kind === 'recitation'
      ? t`Click to mark this recitation as not done`
      : t`Click to mark this lecture as not done`

  return (
    <Tooltip content={done ? revertHint : undefined}>
      <button
        className={`btn ${done ? 'btn--success' : 'btn--info'}`}
        onClick={toggle}
        aria-pressed={done}
      >
        {done && <Icon icon="check" />}
        <Trans>Done</Trans>
      </button>
    </Tooltip>
  )
}
