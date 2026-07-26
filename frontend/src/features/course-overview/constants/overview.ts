import type { CoursePhase, CourseStatus, CourseFile } from '@/types'

export interface OverviewStep {
  phase: CoursePhase
  suffix: string // the file {slug}{suffix} this phase produces
  label: string // human-readable action name (UI only)
}

export const OVERVIEW_STEPS: readonly OverviewStep[] = [
  { phase: 'extract', suffix: '.txt', label: 'Extract' },
  { phase: 'analyze', suffix: '.md', label: 'Analyze' },
  { phase: 'topics', suffix: '.md', label: 'Collect' },
  { phase: 'to_pdf', suffix: '.pdf', label: 'Export PDF' },
]

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
}

// One extractor's derived state; `done` means its last phase output exists.
export function branchStatus(
  status: CourseStatus | null,
  files: CourseFile[],
  slug: string,
  phases: CoursePhase[],
): BranchStatus {
  const st = status?.extractors[slug]
  return {
    running: st?.status === 'running',
    done: files.some((f) => f.name === lastGeneratedFile(slug, phases)),
    error: st?.status === 'error' ? (st.message ?? 'failed') : null,
  }
}
