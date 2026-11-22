import { describe, it, expect } from 'vitest'
import type { Course, InFlightEntry, MergedPdf, RunError, RunnerStatus } from '@/types'
import { mergeInputBytes, mergedRows } from './mergedRows'

const item = (name: string): MergedPdf => ({
  name,
  title: name,
  createdAt: '2026-11-01T10:00:00Z',
  stale: false,
  parts: [],
})
const run = (name: string, waiting = false, course = 'C'): InFlightEntry => ({
  course,
  lecture: name,
  kind: 'merged',
  step: 'merge_pdf',
  startedAt: '2026-11-01T10:00:00Z',
  waiting,
})
const error: RunError = {
  step: 'merge_pdf',
  message: 'x',
  code: 'merge_pdf_failed',
  params: {},
  provider: null,
  blocked: false,
  retry: null,
}
const status = (inFlight: InFlightEntry[], errors: RunnerStatus['errors'] = {}): RunnerStatus => ({
  runner: { running: false, total: 0, done: 0, lastError: null },
  inFlight,
  queue: [],
  overviewRunning: [],
  notices: [],
  errors,
})

describe('mergedRows', () => {
  it('is idle for every stored entry with no status', () => {
    const rows = mergedRows('C', [item('a'), item('b')], null)
    expect(rows.map((r) => [r.name, r.run.state])).toEqual([
      ['a', 'idle'],
      ['b', 'idle'],
    ])
  })

  it('tells a merge waiting on the course lock from one running', () => {
    const rows = mergedRows('C', [item('a'), item('b')], status([run('a', true), run('b')]))
    expect(rows.map((r) => r.run.state)).toEqual(['waiting', 'running'])
  })

  it('shows a failed run beside its stored entry, and prefers a live run over the old error', () => {
    const errors = { 'C||a||merged': error, 'C||b||merged': error }
    const rows = mergedRows('C', [item('a'), item('b')], status([run('b')], errors))
    expect(rows.map((r) => r.run.state)).toEqual(['failed', 'running'])
  })

  it('puts a first creation, which has no stored entry, above the history', () => {
    const rows = mergedRows('C', [item('a')], status([run('new')], { 'C||bad||merged': error }))
    expect(rows.map((r) => [r.name, r.item === null, r.run.state])).toEqual([
      ['new', true, 'running'],
      ['bad', true, 'failed'],
      ['a', false, 'idle'],
    ])
  })

  it('lists a first creation once when it is both running and carries an old error', () => {
    const rows = mergedRows('C', [], status([run('n')], { 'C||n||merged': error }))
    expect(rows).toHaveLength(1)
  })

  it("ignores other courses' runs and the lecture runs of this one", () => {
    const lecture: InFlightEntry = { ...run('x'), kind: 'lecture', step: 'pdf' }
    const rows = mergedRows('C', [], status([run('o', false, 'D'), lecture]))
    expect(rows).toEqual([])
  })
})

describe('mergeInputBytes', () => {
  const lec = (name: string, size: number) => ({ name, files: { 'summary.pdf': { size } } })
  const course = {
    lectures: [lec('L1', 100), lec('L2', 50)],
    recitations: [lec('L1', 7)],
  } as unknown as Course

  it('sums the parts summary.pdf sizes by kind, counting a vanished part as 0', () => {
    const merged: MergedPdf = {
      ...item('a'),
      parts: [
        { name: 'L1', kind: 'lecture', pdfMtime: '', exists: true },
        { name: 'L1', kind: 'recitation', pdfMtime: '', exists: true },
        { name: 'gone', kind: 'lecture', pdfMtime: '', exists: false },
      ],
    }
    expect(mergeInputBytes(merged, course)).toBe(107)
  })

  it('is 0 for a first creation, whose parts the page cannot know', () => {
    expect(mergeInputBytes(null, course)).toBe(0)
  })
})
