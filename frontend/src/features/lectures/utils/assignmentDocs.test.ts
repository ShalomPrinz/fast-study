import { describe, expect, it } from 'vitest'
import type {
  AssignmentDocInfo,
  Assignment,
  Course,
  FileInfo,
  InFlightEntry,
  Lecture,
  RunError,
} from '@/types'
import {
  chosenSummaries,
  docCardState,
  docInputs,
  inputsLocked,
  stepIsDoc,
  summarizedLectures,
} from './assignmentDocs'

const run = (step: string): InFlightEntry => ({
  course: 'C',
  lecture: 'A',
  kind: 'assignment',
  step,
  startedAt: '',
})
const err = (step: string): RunError => ({
  step,
  message: 'm',
  code: null,
  params: {},
  provider: null,
  blocked: false,
  retry: null,
})
const doc = (pdf: number | null, warning: string | null = null): AssignmentDocInfo => ({
  md_mtime: 1,
  pdf_mtime: pdf,
  pdf_warning: warning,
})

describe('docCardState', () => {
  it('is none with no md and no run', () => {
    expect(docCardState('intuition', null, null, null)).toMatchObject({
      phase: 'none',
      busy: false,
      error: null,
    })
  })

  it('is generating for its own step or its pdf, whatever the md', () => {
    expect(docCardState('intuition', null, run('intuition'), null).phase).toBe('generating')
    expect(docCardState('intuition', null, run('intuition_pdf'), null).phase).toBe('generating')
  })

  it('keeps a ready doc ready while only its pdf renders', () => {
    expect(docCardState('intuition', doc(null), run('intuition_pdf'), null)).toMatchObject({
      phase: 'ready',
      rendering: true,
      busy: true,
      pdfMissing: false,
    })
    expect(docCardState('intuition', doc(1), run('intuition'), null)).toMatchObject({
      phase: 'generating',
      rendering: false,
    })
  })

  it("keeps the other doc's card out of generating but busy", () => {
    expect(docCardState('solution', null, run('intuition'), null)).toMatchObject({
      phase: 'none',
      busy: true,
    })
  })

  it('is ready with an md, and flags a missing pdf', () => {
    expect(docCardState('solution', doc(2), null, null)).toMatchObject({
      phase: 'ready',
      pdfMissing: false,
    })
    expect(docCardState('solution', doc(null), null, null).pdfMissing).toBe(true)
  })

  it('shows the error of its own steps only, and not while one runs', () => {
    expect(docCardState('intuition', null, null, err('intuition'))?.error).not.toBeNull()
    expect(docCardState('intuition', doc(1), null, err('intuition_pdf')).error).not.toBeNull()
    expect(docCardState('intuition', null, null, err('solution')).error).toBeNull()
    expect(docCardState('intuition', null, run('intuition'), err('intuition')).error).toBeNull()
  })
})

describe('stepIsDoc', () => {
  it('matches the doc and its pdf render', () => {
    expect(stepIsDoc('solution_pdf', 'solution')).toBe(true)
    expect(stepIsDoc('solution_pdf', 'intuition')).toBe(false)
  })
})

describe('inputsLocked', () => {
  it('locks the switches and the picker while any run is live', () => {
    expect(inputsLocked(run('solution'))).toBe(true)
    expect(inputsLocked(null)).toBe(false)
  })
})

const file = (exists: boolean, size = 0): FileInfo => ({ exists, size, mtime: 1 })
const lecture = (name: string, summary: boolean, size = 0): Lecture => ({
  name,
  files: {
    'video.mp4': file(false),
    'audio.mp3': file(false),
    'transcript.txt': file(false),
    'transcript.partial.txt': file(false),
    'summary.md': file(summary, size),
    'summary.pdf': file(false),
    'drive_url.txt': file(false),
  },
  materials: [],
  summaryMaterials: null,
  transcribePartial: null,
  removed: [],
  done: false,
})
const course = (): Course => ({
  name: 'C',
  archived: false,
  source_url: null,
  lectures_only: false,
  lectures: [lecture('L1', true, 100), lecture('L2', false)],
  recitations: [lecture('R1', true, 50)],
  assignments: [],
})

describe('summarizedLectures', () => {
  it('offers only entries with a summary, lectures then recitations', () => {
    expect(summarizedLectures(course())).toEqual([
      { name: 'L1', kind: 'lecture' },
      { name: 'R1', kind: 'recitation' },
    ])
  })
})

describe('chosenSummaries and docInputs', () => {
  const asg = (over: Partial<Assignment>): Assignment => ({
    name: 'A',
    done: false,
    files: [],
    lectures: [],
    docs: { intuition: null, solution: null },
    ...over,
  })

  it('skips a chosen entry whose summary is gone', () => {
    const chosen = [
      { name: 'L1', kind: 'lecture' as const },
      { name: 'L2', kind: 'lecture' as const },
      { name: 'R1', kind: 'recitation' as const },
    ]
    expect(chosenSummaries(course(), chosen).map((s) => s.entry.name)).toEqual(['L1', 'R1'])
  })

  it('counts switched-on supported files and chosen summaries, and sums their bytes', () => {
    const a = asg({
      files: [
        { name: 'a.pdf', size: 1000, mtime: 1, attach: true },
        { name: 'b.pdf', size: 500, mtime: 1, attach: false },
        { name: 'c.zip', size: 700, mtime: 1, attach: true },
      ],
      lectures: [{ name: 'L1', kind: 'lecture' }],
    })
    expect(docInputs(a, course(), new Set(['pdf']))).toEqual({
      files: 1,
      summaries: 1,
      bytes: 1100,
    })
  })
})
