import { msg } from '@lingui/core/macro'
import type { MessageDescriptor } from '@lingui/core'
import type { AssignmentStep } from '@/types'

const LABELS: Record<AssignmentStep, MessageDescriptor> = {
  intuition: msg`Intuition Guide`,
  solution: msg`Full Solution`,
  intuition_pdf: msg`PDF`,
  solution_pdf: msg`PDF`,
}

// The label an assignment run's step reads as; null for a step this build does not know.
export function assignmentStepLabel(step: string): MessageDescriptor | null {
  return (LABELS as Record<string, MessageDescriptor>)[step] ?? null
}
