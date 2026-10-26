import { useLingui } from '@lingui/react/macro'
import type { AssignmentDocName } from '@/types'
import {
  assignmentGeneratedUrl,
  fetchAssignmentDoc,
  revertAssignmentDoc,
  saveAssignmentDoc,
} from '@/services/database'
import { runAssignmentStep } from '@/services/backend'
import { openAssignmentGenerated } from '@/services/open'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { useRunnerStatus } from '@/shared/contexts/RunnerStatusContext'
import { assignmentRoute } from '@/shared/utils/url'
import type { DocSource } from '@/features/lectures/utils/docSource'

// An assignment's intuition or solution md and pdf, for the route `…/assignment/:assignment/edit/:doc`.
export function useAssignmentDocSource(
  course: string,
  assignment: string,
  doc: AssignmentDocName,
): DocSource {
  const { t } = useLingui()
  const { courses } = useCourseTreeContext()
  const { getAssignmentRun, getAssignmentError, markStarted } = useRunnerStatus()
  const info = courses
    .find((c) => c.name === course)
    ?.assignments.find((a) => a.name === assignment)?.docs[doc]
  const run = getAssignmentRun(course, assignment)
  const error = getAssignmentError(course, assignment)
  const pdfStep = `${doc}_pdf` as const
  return {
    id: `${course}||${assignment}||${doc}`,
    mdName: `${doc}.md`,
    title:
      doc === 'intuition' ? t`Intuition Guide — ${assignment}` : t`Full Solution — ${assignment}`,
    backRoute: assignmentRoute(course, assignment),
    fetch: () => fetchAssignmentDoc(course, assignment, doc),
    save: (content) => saveAssignmentDoc(course, assignment, doc, content),
    restore: () => revertAssignmentDoc(course, assignment, doc),
    pdf: info
      ? {
          mdMtime: info.md_mtime,
          pdfExists: info.pdf_mtime !== null,
          pdfMtime: info.pdf_mtime,
          warning: info.pdf_warning,
        }
      : null,
    pdfUrl: assignmentGeneratedUrl(course, assignment, `${doc}.pdf`),
    runPdf: () => runAssignmentStep(course, assignment, pdfStep, true),
    markStarted: () => markStarted(course, assignment, 'assignment'),
    rendering: run?.step === pdfStep,
    busy: run !== null,
    // Only this doc's render is the editor's outcome; a generation failure belongs to the card.
    error: error?.step === pdfStep ? error : null,
    openPdf: () => void openAssignmentGenerated(course, assignment, `${doc}.pdf`),
  }
}
