// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import type { Course, InFlightEntry, RunError } from '@/types'
import { CourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { RunnerStatusContext } from '@/shared/contexts/RunnerStatusContext'
import { useAssignmentDocSource } from './useAssignmentDocSource'

const svc = vi.hoisted(() => ({
  save: vi.fn(() => Promise.resolve()),
  run: vi.fn(() => Promise.resolve({ status: 'started' as const })),
}))
vi.mock('@/services/database', () => ({
  assignmentGeneratedUrl: (c: string, a: string, n: string) => `db/${c}/${a}/${n}`,
  fetchAssignmentDoc: vi.fn(),
  revertAssignmentDoc: vi.fn(),
  saveAssignmentDoc: svc.save,
}))
vi.mock('@/services/backend', () => ({ runAssignmentStep: svc.run }))
vi.mock('@/services/open', () => ({ openAssignmentGenerated: vi.fn() }))

const info = { md_mtime: 5, pdf_mtime: 3, pdf_warning: null }
const courses = [
  { name: 'C', assignments: [{ name: 'HW', docs: { intuition: info, solution: null } }] },
] as unknown as Course[]

function render(run: InFlightEntry | null = null, error: RunError | null = null) {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      I18nProvider,
      { i18n },
      createElement(
        CourseTreeContext.Provider,
        { value: { courses, loaded: true, loadFailed: false } as never },
        createElement(
          RunnerStatusContext.Provider,
          {
            value: {
              getAssignmentRun: () => run,
              getAssignmentError: () => error,
              markStarted: vi.fn(),
            } as never,
          },
          children,
        ),
      ),
    )
  return renderHook(() => useAssignmentDocSource('C', 'HW', 'intuition'), { wrapper }).result
    .current
}

const entry = (step: string) => ({ step }) as InFlightEntry
const failure = (step: string) => ({ step, message: 'x' }) as RunError

beforeEach(() => vi.clearAllMocks())

describe('useAssignmentDocSource', () => {
  it('saves the doc, then renders its pdf fresh', async () => {
    const source = render()
    await source.save('text')
    await source.runPdf()
    expect(svc.save).toHaveBeenCalledWith('C', 'HW', 'intuition', 'text')
    expect(svc.run).toHaveBeenCalledWith('C', 'HW', 'intuition_pdf', true)
  })

  it('reads the md and pdf state off the tree doc', () => {
    expect(render().pdf).toEqual({ mdMtime: 5, pdfExists: true, pdfMtime: 3, warning: null })
    expect(render().mdName).toBe('intuition.md')
  })

  it('is rendering only for its own pdf step, but busy for any run', () => {
    expect(render(entry('intuition_pdf')).rendering).toBe(true)
    expect(render(entry('solution_pdf')).rendering).toBe(false)
    expect(render(entry('intuition')).rendering).toBe(false)
    expect(render(entry('solution')).busy).toBe(true)
    expect(render().busy).toBe(false)
  })

  it("surfaces only this doc's render failure", () => {
    expect(render(null, failure('intuition_pdf')).error).not.toBeNull()
    expect(render(null, failure('intuition')).error).toBeNull()
    expect(render(null, failure('solution_pdf')).error).toBeNull()
  })
})
