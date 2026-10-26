import {
  fetchSummaryContent,
  saveSummaryContent,
  revertSummary,
  fileUrl,
} from '@/services/database'
import { runStep } from '@/services/backend'
import { openLectureFile } from '@/services/open'
import { useRunnerStatus } from '@/shared/contexts/RunnerStatusContext'
import { lectureRoute } from '@/shared/utils/url'
import { useLectureRoute } from '@/features/lectures/hooks/useLectureRoute'
import { lecturePdfState } from '@/features/lectures/utils/pdfBadge'
import { pdfGenerating } from '@/features/lectures/utils/summaryBuffer'
import type { DocSource } from '@/features/lectures/utils/docSource'

// A lecture's or recitation's summary.md and summary.pdf, for the route `/:course/:lecture/edit`.
export function useLectureDocSource(): DocSource {
  const { course, lecture, kind, files } = useLectureRoute()
  const { getError, getInFlight, isInFlight, markStarted } = useRunnerStatus()
  return {
    id: `${course}||${lecture}||${kind}`,
    mdName: 'summary.md',
    title: lecture,
    // The lecture, not history: the editor is often reached from a fresh tab or another page.
    backRoute: lectureRoute(course, lecture, kind),
    fetch: () => fetchSummaryContent(course, lecture, kind),
    save: (content) => saveSummaryContent(course, lecture, content, kind),
    restore: () => revertSummary(course, lecture, kind),
    pdf: files && lecturePdfState(files),
    pdfUrl: fileUrl(course, lecture, 'summary.pdf', kind),
    runPdf: () => runStep(course, lecture, 'pdf', kind, true),
    markStarted: () => markStarted(course, lecture, kind),
    rendering: pdfGenerating(false, getInFlight(course, lecture, kind)),
    busy: isInFlight(course, lecture, kind),
    error: getError(course, lecture, kind),
    openPdf: () => void openLectureFile(course, lecture, 'summary.pdf', kind),
  }
}
