import { describe, it, expect } from 'vitest'
import { assignmentStepLabel } from './assignmentSteps'

describe('assignmentStepLabel', () => {
  it('gives both PDF renders the one PDF label and the docs their own', () => {
    expect(assignmentStepLabel('intuition_pdf')).toEqual(assignmentStepLabel('solution_pdf'))
    expect(assignmentStepLabel('intuition')).not.toEqual(assignmentStepLabel('solution'))
    expect(assignmentStepLabel('intuition')).not.toEqual(assignmentStepLabel('intuition_pdf'))
  })

  it('has no label for a step it does not know', () => {
    expect(assignmentStepLabel('summarize')).toBeNull()
  })
})
