import { useCourseOverview } from '@/routes/course/CourseOverviewContext'
import { startedSlug } from '@/constants/overview'
import { toastInitResult } from '@/services/toaster'

// Course overview header run control
export default function GenerateAllButton() {
  const { extractors, files, status, generate } = useCourseOverview()
  const running = status?.running ?? false

  // Any produced file means we're continuing rather than starting fresh
  const existingFiles = new Set(files.map((f) => f.name))
  const hasStarted = (extractors ?? []).some(({ slug, phases }) => startedSlug(slug, phases, existingFiles) !== null)

  async function handleGenerate() {
    const result = await generate(undefined, undefined, true)
    toastInitResult(result, {
      busy: 'Overview is already running for this course',
      error: 'Overview failed to start',
    })
  }

  return (
    <button
      className="run-all-btn course-global-btn"
      onClick={handleGenerate}
      disabled={running || extractors === null}
    >
      {running && <span className="spinner spinner--sm" />}
      {running ? 'Generating…' : hasStarted ? 'Continue Generating' : 'Generate All'}
    </button>
  )
}
