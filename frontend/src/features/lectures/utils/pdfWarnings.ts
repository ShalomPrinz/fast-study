import type { Course } from '@/types'
import type { ReportOnce } from '@/shared/hooks/useReportOnce'
import { inFlightKey } from '@/shared/utils/inFlightKey'

// A PDF that rendered despite XeLaTeX errors carries a one-line `warning` on its summary.pdf tree entry.
export function collectPdfWarnings(courses: Course[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const course of courses) {
    for (const [kind, lectures] of [
      ['lecture', course.lectures],
      ['recitation', course.recitations],
    ] as const) {
      for (const lecture of lectures) {
        const warning = lecture.files?.['summary.pdf']?.warning
        if (warning)
          out.set(inFlightKey(course.name, lecture.name, kind), `${lecture.name}: ${warning}`)
      }
    }
  }
  return out
}

// Announce each warning once. `primed` is false for the first applied tree, so warnings that predate
// page load are only seeded (recorded, not toasted); pruning rearms a key once its warning is gone.
export function announcePdfWarnings(courses: Course[], api: ReportOnce, primed: boolean): void {
  const warnings = collectPdfWarnings(courses)
  api.prune(new Set(warnings.keys()))
  const announce = primed ? api.report : api.seed
  for (const [key, message] of warnings) announce(key, message)
}
