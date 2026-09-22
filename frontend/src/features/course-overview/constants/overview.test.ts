import { describe, it, expect } from 'vitest'
import type { CourseExtractorState, CourseFile, CoursePhase, CourseStatus } from '@/types'
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
const skipped = (over: Partial<CourseExtractorState>): CourseStatus => ({
  running: false,
  extractors: { [SLUG]: { status: 'skipped', ...over } },
})

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

  // Codes, never copy: a skip's sentence belongs to the catalogs.
  it('surfaces a skipped phase as a warning, never as an error', () => {
    const st = skipped({ message: 'no snippets found', code: 'no_snippets_found' })
    const bs = branchStatus(st, [], SLUG, PHASES)

    expect(bs.error).toBeNull()
    expect(bs.warning).not.toBeNull()
    expect(bs.warning).not.toBe('no snippets found')
  })

  it("fills a skip reason's params into its sentence", () => {
    const st = skipped({
      message: 'no snippets file — run extract first',
      code: 'missing_prerequisite',
      params: { file: 'exams.txt', step: 'extract' },
    })

    expect(branchStatus(st, [], SLUG, PHASES).warning).toContain('exams.txt')
  })

  it("falls back to the service's prose for a skip code it has never heard of", () => {
    const st = skipped({ message: 'nothing to do here', code: 'invented_by_a_future_service' })
    expect(branchStatus(st, [], SLUG, PHASES).warning).toBe('nothing to do here')
  })

  it('says nothing about an already-generated branch, which reads as done', () => {
    const st = skipped({ message: 'already generated', code: 'already_generated' })
    const bs = branchStatus(st, [file('exams.pdf')], SLUG, PHASES)

    expect(bs.done).toBe(true)
    expect(bs.warning).toBeNull()
  })

  it("prefers this run's skip reason over an older PDF's render warning", () => {
    const st = skipped({ message: 'no snippets found', code: 'no_snippets_found' })
    const bs = branchStatus(st, [file('exams.pdf', { warning: WARNING })], SLUG, PHASES)

    expect(bs.warning).not.toBe(WARNING)
  })
})
