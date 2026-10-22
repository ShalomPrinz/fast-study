import { useLingui } from '@lingui/react/macro'
import { useCourseOverview } from '@/features/course-overview/contexts/CourseOverviewContext'
import { branchStatus, startedSlug } from '@/features/course-overview/constants/overview'
import { toastInitResult } from '@/services/toaster'
import Tooltip from '@/shared/components/Tooltip'
import { toastFailure } from '@/shared/utils/failure'
import '@/styles/spinner.css'
import '@/styles/button.css'

export default function GenerateAllButton() {
  const { t } = useLingui()
  const { extractors, files, status, generate } = useCourseOverview()
  const running = status?.running ?? false

  // Any existing output means this is a continue, not a fresh start.
  const existingFiles = new Set(files.map((f) => f.name))
  const hasStarted = (extractors ?? []).some(
    ({ slug, phases }) => startedSlug(slug, phases, existingFiles) !== null,
  )
  // Nothing left for this button to start; a single branch is re-run from its own row.
  const allDone =
    extractors !== null &&
    extractors.length > 0 &&
    extractors.every((e) => branchStatus(status, files, e.slug, e.phases).done)

  async function handleGenerate() {
    try {
      toastInitResult(await generate(undefined, undefined, true), {
        busy: t`Overview is already running for this course`,
      })
    } catch (e) {
      toastFailure(e)
    }
  }

  const enabled = !running && extractors !== null && !allDone

  return (
    <Tooltip
      content={
        enabled
          ? t`Creates comprehensive summaries for all lectures and recitations in the course`
          : undefined
      }
    >
      <button className="btn btn--primary" onClick={handleGenerate} disabled={!enabled}>
        {running && <span className="spinner spinner--sm" />}
        {running
          ? t`Generating…`
          : allDone
            ? t`All Generated`
            : hasStarted
              ? t`Continue Generating`
              : t`Generate Course Overviews`}
      </button>
    </Tooltip>
  )
}
