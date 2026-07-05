import type { CoursePhase } from '@/types'

export const OVERVIEW_PHASES: Array<{ phase: CoursePhase; suffix: string; label: string }> = [
  { phase: 'extract', suffix: '.txt',          label: 'Snippets'    },
  { phase: 'analyze', suffix: '-analyzed.md',  label: 'Study notes' },
]

const PHASE_SUFFIX_MUT: Record<CoursePhase, string> = {} as Record<CoursePhase, string>
const PHASE_LABEL_MUT: Record<CoursePhase, string> = {} as Record<CoursePhase, string>

for (const p of OVERVIEW_PHASES) {
  PHASE_SUFFIX_MUT[p.phase] = p.suffix
  PHASE_LABEL_MUT[p.phase] = p.label
}

export const PHASE_SUFFIX: Record<CoursePhase, string> = PHASE_SUFFIX_MUT
export const PHASE_LABEL: Record<CoursePhase, string> = PHASE_LABEL_MUT

export function stageFileName(slug: string, phase: CoursePhase): string {
  return `${slug}${PHASE_SUFFIX[phase]}`
}
