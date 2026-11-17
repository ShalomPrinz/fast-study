// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useReportOnce } from '@/shared/hooks/useReportOnce'
import { MISSING_CHARS_WARNING } from '@/shared/utils/pdfWarningText'
import type { Course, FileInfo, FileStatus, Lecture } from '@/types'
import type { ReportOnce } from '@/shared/hooks/useReportOnce'
let shown = 'English'
vi.mock('@/shared/utils/pdfWarningText', async (orig) => ({
  ...(await orig<object>()),
  pdfWarningText: (w: string) => (w === MISSING_CHARS_WARNING ? shown : w),
}))

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
  return {
    name,
    files,
    materials: [],
    summaryMaterials: null,
    transcribePartial: null,
    removed: [],
    done: false,
    figuresPending: false,
  }
}

function tree(...lectures: Lecture[]): Course[] {
  return [
    {
      name: 'Algebra',
      source_url: null,
      lectures_only: false,
      lectures,
      recitations: [],
      assignments: [],
      skipped: [],
    },
  ]
}

describe('collectPdfWarnings', () => {
  it('picks up only lectures whose summary.pdf carries a warning', () => {
    const warnings = collectPdfWarnings(
      tree(lecture('L1'), lecture('L2', 'LaTeX error: bad macro')),
    )
    expect([...warnings.values()]).toEqual([{ lecture: 'L2', warning: 'LaTeX error: bad macro' }])
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
      report: (_key, id, payload = id) => calls.reported.push(payload),
      seed: (_key, id) => calls.seeded.push(id),
      prune: (validKeys) => calls.pruned.push([...validKeys]),
    }
    return { calls, api }
  }

  it('only seeds on the first tree, so a warning predating page load never toasts', () => {
    const { calls, api } = harness()
    announcePdfWarnings(tree(lecture('L1', 'old warning')), api, false)
    expect(calls.seeded).toEqual(['old warning'])
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

describe('announcePdfWarnings across a locale switch', () => {
  it('does not re-toast a marker warning once the shown text changes', () => {
    const send = vi.fn()
    const { result } = renderHook(() => useReportOnce<string>(send))
    const t1 = tree(lecture('L1', MISSING_CHARS_WARNING), lecture('L2', MISSING_CHARS_WARNING))
    shown = 'English'
    announcePdfWarnings(t1, result.current, false)
    announcePdfWarnings(
      tree(lecture('L1', MISSING_CHARS_WARNING), lecture('L3', MISSING_CHARS_WARNING)),
      result.current,
      true,
    )
    expect(send.mock.calls).toEqual([['L3: English']])
    shown = 'Hebrew'
    announcePdfWarnings(
      tree(lecture('L1', MISSING_CHARS_WARNING), lecture('L3', MISSING_CHARS_WARNING)),
      result.current,
      true,
    )
    expect(send).toHaveBeenCalledTimes(1)
  })
})
