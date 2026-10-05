import { msg, t } from '@lingui/core/macro'
import { i18n } from '@lingui/core'
import type { MessageDescriptor } from '@lingui/core'
import type { CoursePhase, CourseStatus, CourseExtractorState, CourseFile, PdfBadge } from '@/types'
import { serviceErrorText } from '@/shared/i18n/serviceErrors'

export interface OverviewStep {
  phase: CoursePhase
  suffix: string // the file {slug}{suffix} this phase produces
  // Human-readable action name (UI only). A descriptor, since this table outlives any locale.
  label: MessageDescriptor
}

export const OVERVIEW_STEPS: readonly OverviewStep[] = [
  { phase: 'extract', suffix: '.txt', label: msg`Extract` },
  { phase: 'analyze', suffix: '.md', label: msg`Analyze` },
  { phase: 'topics', suffix: '.md', label: msg`Collect` },
  { phase: 'compile', suffix: '.md', label: msg`Compile` },
  { phase: 'to_pdf', suffix: '.pdf', label: msg`Export PDF` },
]

// The backend's extractor titles are English developer copy; the UI names each slug itself.
const EXTRACTOR_TITLES: Record<string, MessageDescriptor> = {
  'exam-hints': msg`Exam Hints`,
  'student-qa': msg`Student QA`,
  pitfalls: msg`Pitfalls`,
  topics: msg`Topics`,
  'all-lectures': msg`All Lectures`,
}

// An unknown slug falls back to the backend's own title, so a new extractor still renders.
export function extractorTitle(extractor: { slug: string; title: string }): string {
  const descriptor = EXTRACTOR_TITLES[extractor.slug]
  return descriptor ? i18n._(descriptor) : extractor.title
}

export function stepsFor(phases: CoursePhase[]): OverviewStep[] {
  return OVERVIEW_STEPS.filter((s) => phases.includes(s.phase))
}

export function generatedFiles(slug: string, phases: CoursePhase[]): string[] {
  return stepsFor(phases).map((s) => `${slug}${s.suffix}`)
}

export function lastGeneratedFile(slug: string, phases: CoursePhase[]): string {
  const files = generatedFiles(slug, phases)
  return files[files.length - 1]
}

export interface StartedSlug {
  furthest: string // furthest pipeline output already on disk
}

// How far a slug got; null when nothing exists yet — a fresh generation, not a continue.
export function startedSlug(
  slug: string,
  phases: CoursePhase[],
  existing: Set<string>,
): StartedSlug | null {
  const produced = generatedFiles(slug, phases)
  let furthestIdx = -1
  produced.forEach((name, i) => {
    if (existing.has(name)) furthestIdx = i
  })
  if (furthestIdx === -1) return null
  return { furthest: produced[furthestIdx] }
}

export interface BranchStatus {
  running: boolean
  done: boolean
  error: string | null
  warning: string | null
}

// The kept-on-disk skip: the branch already reads as done and every "Generate all" pass re-stamps
// it, so announcing it would badge every finished branch on the healthy path.
const SILENT_SKIP_CODES = new Set(['already_generated'])

// Why a phase chain stopped short of producing anything. A skip is not a failure, so its reason
// rides the neutral `warning` channel rather than `error`.
function skipReason(st: CourseExtractorState | undefined): string | null {
  if (st?.status !== 'skipped') return null
  if (st.code && SILENT_SKIP_CODES.has(st.code)) return null
  return serviceErrorText({ message: st.message ?? t`skipped`, code: st.code, params: st.params })
}

// One extractor's derived state; `done` means its last phase output exists.
// `warning` is the neutral channel — a skipped phase's reason, else the produced PDF's render
// warning. Neither is a failure, so the branch still reads as done.
export function branchStatus(
  status: CourseStatus | null,
  files: CourseFile[],
  slug: string,
  phases: CoursePhase[],
): BranchStatus {
  const st = status?.extractors[slug]
  const last = files.find((f) => f.name === lastGeneratedFile(slug, phases))
  return {
    running: st?.status === 'running',
    done: last !== undefined,
    error:
      st?.status === 'error'
        ? serviceErrorText({ message: st.message ?? t`failed`, code: st.code, params: st.params })
        : null,
    // The skip is about this run; a render warning may be left over from an older one.
    warning: skipReason(st) ?? last?.warning ?? null,
  }
}

// A getter, not a constant: the copy has to resolve against whichever locale is active now.
export const staleBranchTitle = (): string =>
  t`The PDF is older than an earlier step's output. Re-generate it.`

// The PDF is stale once any earlier output is newer — what a failed analyze/to_pdf leaves behind,
// over a meta range that already moved. A missing PDF never is: the branch reads as not done instead.
export function isBranchStale(files: CourseFile[], slug: string, phases: CoursePhase[]): boolean {
  const names = generatedFiles(slug, phases)
  const byName = new Map(files.map((f) => [f.name, f]))
  const pdf = byName.get(names[names.length - 1])
  if (!pdf) return false
  return names.slice(0, -1).some((n) => (byName.get(n)?.mtime ?? -Infinity) > pdf.mtime)
}

// One badge per row, as in the lectures' pdfBadge: the neutral warning outranks staleness.
export function branchBadge(
  bs: BranchStatus,
  files: CourseFile[],
  slug: string,
  phases: CoursePhase[],
): PdfBadge | null {
  if (bs.warning) return { kind: 'warning', title: bs.warning }
  if (isBranchStale(files, slug, phases)) return { kind: 'stale', title: staleBranchTitle() }
  return null
}
