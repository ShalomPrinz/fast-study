import type { Course } from '@/types'
import type { ReportOnce } from '@/shared/hooks/useReportOnce'
import { pdfWarningText } from '@/shared/utils/pdfWarningText'
import { inFlightKey } from '@/shared/utils/inFlightKey'

// A PDF that rendered despite LaTeX errors carries a one-line `warning` on its summary.pdf tree entry.
export function collectPdfWarnings(
  courses: Course[],
): Map<string, { lecture: string; warning: string }> {
  const out = new Map<string, { lecture: string; warning: string }>()
  for (const course of courses) {
    for (const [kind, lectures] of [
      ['lecture', course.lectures],
      ['recitation', course.recitations],
    ] as const) {
      for (const lecture of lectures) {
        const warning = lecture.files?.['summary.pdf']?.warning
        if (warning)
          out.set(inFlightKey(course.name, lecture.name, kind), { lecture: lecture.name, warning })
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
  // The raw warning is the dedupe id, so a locale switch (no reload) never re-toasts; only the shown text is translated.
  for (const [key, { lecture, warning }] of warnings) {
    if (primed) api.report(key, warning, `${lecture}: ${pdfWarningText(warning)}`)
    else api.seed(key, warning)
  }
}
