import { describe, it, expect } from 'vitest'
import type { Course, FileInfo, FileStatus, Lecture } from '@/types'
import type { ReportOnce } from '@/shared/hooks/useReportOnce'
import { announcePdfWarnings, collectPdfWarnings } from './pdfWarnings'

const EMPTY: FileInfo = { exists: false, size: null, mtime: null }

function lecture(name: string, warning?: string): Lecture {
  const files = {
    'video.mp4': EMPTY,
    'audio.mp3': EMPTY,
    'transcript.txt': EMPTY,
    'transcript.partial.txt': EMPTY,
    'summary.md': EMPTY,
    'summary.pdf': { exists: true, size: 10, mtime: 1, ...(warning ? { warning } : {}) },
    'drive_url.txt': EMPTY,
  } satisfies FileStatus
  return { name, files, materials: [], transcribePartial: null }
}

function tree(...lectures: Lecture[]): Course[] {
  return [{ name: 'Algebra', archived: false, source_url: null, lectures, recitations: [] }]
}

describe('collectPdfWarnings', () => {
  it('picks up only lectures whose summary.pdf carries a warning', () => {
    const warnings = collectPdfWarnings(
      tree(lecture('L1'), lecture('L2', 'LaTeX error: bad macro')),
    )
    expect([...warnings.values()]).toEqual(['L2: LaTeX error: bad macro'])
    expect([...warnings.keys()]).toEqual(['Algebra||L2||lecture'])
  })

  it('covers recitations too', () => {
    const [course] = tree()
    const warnings = collectPdfWarnings([{ ...course, recitations: [lecture('R1', 'boom')] }])
    expect([...warnings.keys()]).toEqual(['Algebra||R1||recitation'])
  })
})

describe('announcePdfWarnings', () => {
  // Recording stand-in for useReportOnce: dedupe is the hook's job, so what is
  // asserted here is the decision announce makes — seed vs report, and the prune set.
  function harness() {
    const calls = { reported: [] as string[], seeded: [] as string[], pruned: [] as string[][] }
    const api: ReportOnce = {
      report: (_key, msg) => calls.reported.push(msg),
      seed: (_key, msg) => calls.seeded.push(msg),
      prune: (validKeys) => calls.pruned.push([...validKeys]),
    }
    return { calls, api }
  }

  it('only seeds on the first tree, so a warning predating page load never toasts', () => {
    const { calls, api } = harness()
    announcePdfWarnings(tree(lecture('L1', 'old warning')), api, false)
    expect(calls.seeded).toEqual(['L1: old warning'])
    expect(calls.reported).toEqual([])
  })

  it('reports a warning once the tree is primed', () => {
    const { calls, api } = harness()
    announcePdfWarnings(tree(lecture('L1', 'new warning')), api, true)
    expect(calls.reported).toEqual(['L1: new warning'])
    expect(calls.seeded).toEqual([])
  })

  it('prunes to the live warning keys, rearming a lecture whose warning is gone', () => {
    const { calls, api } = harness()
    announcePdfWarnings(tree(lecture('L1', 'flaky'), lecture('L2')), api, true)
    announcePdfWarnings(tree(lecture('L1'), lecture('L2')), api, true)
    expect(calls.pruned).toEqual([['Algebra||L1||lecture'], []])
  })
})
