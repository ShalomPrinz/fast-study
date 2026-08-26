import { useLingui } from '@lingui/react/macro'
import { useCourseOverview } from '@/features/course-overview/contexts/CourseOverviewContext'
import { startedSlug } from '@/features/course-overview/constants/overview'
import { toastInitResult } from '@/services/toaster'
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

  async function handleGenerate() {
    const result = await generate(undefined, undefined, true)
    toastInitResult(result, {
      busy: t`Overview is already running for this course`,
      error: t`Overview failed to start`,
    })
  }

  return (
    <button
      className="btn btn--primary"
      onClick={handleGenerate}
      disabled={running || extractors === null}
    >
      {running && <span className="spinner spinner--sm" />}
      {running ? t`Generating…` : hasStarted ? t`Continue Generating` : t`Generate All`}
    </button>
  )
}
