import { describe, it, expect } from 'vitest'
import type { CourseFile, CoursePhase, CourseStatus } from '@/types'
import { branchStatus } from './overview'

const PHASES: CoursePhase[] = ['extract', 'analyze', 'to_pdf']
const SLUG = 'exams'
const WARNING = 'Rendered with LaTeX errors: Undefined control sequence at line 42'

const file = (name: string, over: Partial<CourseFile> = {}): CourseFile => ({
  name,
  size: 1,
  mtime: 100,
  ...over,
})

const running: CourseStatus = { running: true, extractors: { [SLUG]: { status: 'running' } } }
const failed: CourseStatus = {
  running: false,
  extractors: { [SLUG]: { status: 'error', message: 'to_pdf blew up' } },
}

describe('branchStatus', () => {
  it('has no warning when the PDF rendered clean', () => {
    const bs = branchStatus(null, [file('exams.pdf')], SLUG, PHASES)
    expect(bs).toEqual({ running: false, done: true, error: null, warning: null })
  })

  it('surfaces the render warning from the produced PDF', () => {
    const files = [file('exams.txt'), file('exams.pdf', { warning: WARNING })]
    expect(branchStatus(null, files, SLUG, PHASES).warning).toBe(WARNING)
  })

  it('still reads as done, not error, when the PDF carries a warning', () => {
    const bs = branchStatus(null, [file('exams.pdf', { warning: WARNING })], SLUG, PHASES)
    expect(bs.done).toBe(true)
    expect(bs.error).toBeNull()
  })

  it('ignores a warning on a file that is not the final output', () => {
    const files = [file('exams.txt', { warning: WARNING }), file('exams.pdf')]
    expect(branchStatus(null, files, SLUG, PHASES).warning).toBeNull()
  })

  it('has no warning while nothing is generated', () => {
    expect(branchStatus(running, [], SLUG, PHASES)).toEqual({
      running: true,
      done: false,
      error: null,
      warning: null,
    })
  })

  it('keeps the error path untouched', () => {
    expect(branchStatus(failed, [], SLUG, PHASES).error).toBe('to_pdf blew up')
  })
})
