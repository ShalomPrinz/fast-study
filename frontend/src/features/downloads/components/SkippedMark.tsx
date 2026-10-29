import { Trans } from '@lingui/react/macro'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { updateSkipped } from '@/services/database'
import { toastFailure } from '@/shared/utils/failure'
import '@/styles/button.css'
import '@/styles/chip.css'

// The All view's mark on a row whose ref is in the course's skip set: a chip and a Restore that
// returns it to the New view. Renders nothing for any other row.
export default function SkippedMark({ course, refKey }: { course: string; refKey: string }) {
  const { courses } = useCourseTreeContext()
  if (!courses.find((c) => c.name === course)?.skipped?.includes(refKey)) return null
  async function restore() {
    try {
      await updateSkipped(course, { remove: [refKey] })
    } catch (err) {
      toastFailure(err)
    }
  }
  return (
    <>
      <span className="chip chip--neutral skipped-chip">
        <Trans>Skipped</Trans>
      </span>
      <button className="btn btn--ghost skipped-restore" onClick={() => void restore()}>
        <Trans>Restore</Trans>
      </button>
    </>
  )
}
