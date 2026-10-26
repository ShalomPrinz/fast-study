import type {
  Assignment,
  AssignmentDocInfo,
  AssignmentDocName,
  AssignmentLecture,
  Course,
  InFlightEntry,
  RunError,
} from '@/types'
import { attachedMaterials, type SupportedExtensions } from './materials'

/** Whether a run's or error's step belongs to this doc: its generation or its PDF render. */
export function stepIsDoc(step: string, doc: AssignmentDocName): boolean {
  return step === doc || step === `${doc}_pdf`
}

export interface DocCardState {
  phase: 'none' | 'generating' | 'ready'
  // Any assignment run is live: the runner holds one per assignment, so both cards wait.
  busy: boolean
  pdfMissing: boolean
  // Only the PDF render is running: a ready doc keeps its layout and shows the progress.
  rendering: boolean
  // The last failure of this doc's steps, hidden while one runs.
  error: RunError | null
}

/** What a doc card shows, from the tree's doc entry and the assignment's run and error. */
export function docCardState(
  doc: AssignmentDocName,
  info: AssignmentDocInfo | null,
  run: InFlightEntry | null,
  error: RunError | null,
): DocCardState {
  const generating = !!run && stepIsDoc(run.step, doc)
  const rendering = generating && run.step.endsWith('_pdf')
  const phase = generating && !(rendering && info) ? 'generating' : info ? 'ready' : 'none'
  return {
    phase,
    busy: !!run,
    rendering,
    pdfMissing: phase === 'ready' && !rendering && info?.pdf_mtime === null,
    error: !generating && error && stepIsDoc(error.step, doc) ? error : null,
  }
}

/** The lectures or recitations of a course that have a summary: the only ones the picker offers. */
export function summarizedLectures(course: Course): AssignmentLecture[] {
  const pick = (kind: AssignmentLecture['kind'], list: Course['lectures']) =>
    list.filter((l) => l.files['summary.md'].exists).map((l) => ({ name: l.name, kind }))
  return [...pick('lecture', course.lectures), ...pick('recitation', course.recitations)]
}

/** The chosen entries whose summary exists right now, with its size on disk. */
export function chosenSummaries(
  course: Course,
  chosen: AssignmentLecture[],
): { entry: AssignmentLecture; bytes: number }[] {
  const out: { entry: AssignmentLecture; bytes: number }[] = []
  for (const entry of chosen) {
    const list = entry.kind === 'recitation' ? course.recitations : course.lectures
    const file = list.find((l) => l.name === entry.name)?.files['summary.md']
    if (file?.exists) out.push({ entry, bytes: file.size ?? 0 })
  }
  return out
}

/** What generation would send: the switched-on supported files and the chosen summaries. */
export function docInputs(
  assignment: Assignment,
  course: Course,
  supported: SupportedExtensions,
): { files: number; summaries: number; bytes: number } {
  const files = attachedMaterials(assignment.files, supported)
  const summaries = chosenSummaries(course, assignment.lectures)
  return {
    files: files.length,
    summaries: summaries.length,
    // Office files are sent as extracted text, so on-disk size only approximates what Gemini gets.
    bytes: files.reduce((n, f) => n + f.size, 0) + summaries.reduce((n, s) => n + s.bytes, 0),
  }
}

/** The attach switch and the course-material picker wait while the assignment has a live run, which reads them. */
export function inputsLocked(run: InFlightEntry | null): boolean {
  return run !== null
}
